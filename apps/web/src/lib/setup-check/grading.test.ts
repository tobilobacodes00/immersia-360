import { describe, expect, it } from 'vitest';
import {
  CRITICAL_STORAGE_BYTES,
  FPS_FLOOR,
  SLOW_UPLOAD_MBPS,
  cameraOpenFailed,
  gradeCamera,
  gradeNetwork,
  gradePrinter,
  gradeQr,
  gradeStorage,
  gradeTake,
  isLocalOrigin,
  overall,
  worst,
} from './grading';

const GB = 1024 ** 3;

describe('camera grade', () => {
  const base = {
    simulator: false,
    targetFps: 60,
    measuredFps: 59.6,
    targetResolution: '1080p' as const,
    width: 1920,
    height: 1080,
  };

  it('passes a camera that delivers what the event asks for', () => {
    expect(gradeCamera(base)).toEqual([{ status: 'pass', code: 'ok' }]);
  });

  it('warns when the camera is slower than the event but still smooth (a 30 fps webcam on a 60 fps event)', () => {
    const f = gradeCamera({ ...base, measuredFps: 30 });
    expect(f).toEqual([{ status: 'warn', code: 'fpsBelowEvent', params: { fps: 30, target: 60 } }]);
  });

  it('fails a choppy camera whatever the event asks for', () => {
    const f = gradeCamera({ ...base, targetFps: 30, measuredFps: FPS_FLOOR - 1 });
    expect(f[0]).toMatchObject({ status: 'fail', code: 'fpsTooLow' });
  });

  it('accepts 29.97 as 30', () => {
    expect(gradeCamera({ ...base, targetFps: 30, measuredFps: 29.97 })[0]?.status).toBe('pass');
  });

  it('warns about a lower resolution than the event, measuring the short side', () => {
    const f = gradeCamera({ ...base, width: 1280, height: 720 });
    expect(f).toEqual([
      { status: 'warn', code: 'resolutionBelowEvent', params: { size: '1280×720', target: '1080p' } },
    ]);
    // A portrait phone camera delivers 1080×1920: same short side, no warning.
    expect(gradeCamera({ ...base, width: 1080, height: 1920 })[0]?.status).toBe('pass');
  });

  it('flags the simulator so nobody thinks the real camera was checked', () => {
    expect(gradeCamera({ ...base, simulator: true }).map((x) => x.code)).toContain('simulator');
  });

  it('turns a camera that will not open into a fail with its own advice', () => {
    expect(cameraOpenFailed('permission')).toEqual([{ status: 'fail', code: 'permission' }]);
    expect(cameraOpenFailed('in_use')[0]?.code).toBe('in_use');
    expect(cameraOpenFailed('weird')[0]?.code).toBe('unknown');
  });

  it('says so when it could not count frames', () => {
    expect(gradeCamera({ ...base, measuredFps: null })[0]).toMatchObject({ status: 'warn', code: 'fpsUnmeasured' });
  });
});

describe('storage grade', () => {
  const base = {
    persisted: true,
    freeBytes: 20 * GB,
    available: true,
    backend: 'opfs' as const,
    apple: false,
    standalone: false,
  };

  it('passes plenty of free, persistent space', () => {
    expect(gradeStorage(base)).toEqual([{ status: 'pass', code: 'ok' }]);
  });

  it('warns under 2 GB (the PRD line) and fails when almost nothing is left', () => {
    expect(gradeStorage({ ...base, freeBytes: 1.5 * GB })[0]).toMatchObject({
      status: 'warn',
      code: 'lowSpace',
      params: { gb: 1.5 },
    });
    expect(gradeStorage({ ...base, freeBytes: CRITICAL_STORAGE_BYTES - 1 })[0]).toMatchObject({
      status: 'fail',
      code: 'criticalSpace',
    });
    expect(gradeStorage({ ...base, freeBytes: 2 * GB })[0]?.status).toBe('pass');
  });

  it('explains the iOS eviction risk only where it applies', () => {
    expect(gradeStorage({ ...base, persisted: false, apple: true })[0]?.code).toBe('notPersistedApple');
    // Installed to the Home Screen: Safari does not clear an installed app's data after a week.
    expect(gradeStorage({ ...base, persisted: false, apple: true, standalone: true })[0]?.code).toBe('notPersisted');
    expect(gradeStorage({ ...base, persisted: false })[0]?.code).toBe('notPersisted');
  });

  it('warns about the IndexedDB fallback and about unknown free space', () => {
    expect(gradeStorage({ ...base, backend: 'idb' })[0]?.code).toBe('idbBackend');
    expect(gradeStorage({ ...base, freeBytes: null })[0]?.code).toBe('spaceUnknown');
  });

  it('fails a browser with no storage at all', () => {
    expect(gradeStorage({ ...base, available: false })).toEqual([{ status: 'fail', code: 'noStorage' }]);
  });

  it('reports every problem, not just the first', () => {
    const f = gradeStorage({ ...base, freeBytes: 1 * GB, persisted: false, backend: 'idb' });
    expect(f.map((x) => x.code)).toEqual(['lowSpace', 'notPersisted', 'idbBackend']);
    expect(worst(f)).toBe('warn');
  });
});

describe('test take grade', () => {
  it('passes a take that recorded about as long as asked', () => {
    expect(gradeTake({ kind: 'recorded', requestedMs: 4000, recordedMs: 4050, bytes: 900_000, chunks: 4 })).toEqual([
      { status: 'pass', code: 'ok' },
    ]);
  });
  it('warns about a take that came out short', () => {
    expect(
      gradeTake({ kind: 'recorded', requestedMs: 4000, recordedMs: 1500, bytes: 400_000, chunks: 2 })[0],
    ).toMatchObject({
      status: 'warn',
      code: 'short',
      params: { seconds: 1.5, asked: 4 },
    });
  });
  it('fails an empty take, a browser that cannot record, and a failed write', () => {
    expect(gradeTake({ kind: 'recorded', requestedMs: 4000, recordedMs: 4000, bytes: 0, chunks: 0 })[0]?.code).toBe(
      'empty',
    );
    expect(gradeTake({ kind: 'unsupported' })[0]?.code).toBe('unsupported');
    expect(gradeTake({ kind: 'writeFailed' })[0]?.code).toBe('writeFailed');
    expect(gradeTake({ kind: 'noCamera' })[0]?.code).toBe('noCamera');
  });
});

describe('test QR, printer and network grades', () => {
  it('a scan passes, except from an address a phone cannot reach', () => {
    expect(gradeQr({ kind: 'scanned', localhost: false })[0]?.status).toBe('pass');
    expect(gradeQr({ kind: 'scanned', localhost: true })[0]).toMatchObject({ status: 'warn', code: 'okLocalhost' });
    expect(gradeQr({ kind: 'expired' })[0]?.status).toBe('warn');
    expect(gradeQr({ kind: 'offline' })[0]?.status).toBe('fail');
    expect(isLocalOrigin('localhost')).toBe(true);
    expect(isLocalOrigin('127.0.0.1')).toBe(true);
    expect(isLocalOrigin('app.example.com')).toBe(false);
    expect(isLocalOrigin('192.168.1.20')).toBe(false);
  });

  it('the printer grade follows what the operator measured', () => {
    expect(gradePrinter('matches')[0]?.status).toBe('pass');
    expect(gradePrinter('off')[0]).toMatchObject({ status: 'fail', code: 'off' });
    expect(gradePrinter('cropped')[0]).toMatchObject({ status: 'warn', code: 'cropped' });
    expect(gradePrinter('nothing')[0]?.status).toBe('fail');
  });

  it('the network grade warns on a slow link and fails on a broken one', () => {
    expect(gradeNetwork({ kind: 'ok', mbps: 40 })[0]).toMatchObject({ status: 'pass', code: 'ok' });
    // 12 MB at 40 Mbit/s is 2.4 s.
    expect(gradeNetwork({ kind: 'ok', mbps: 40 })[0]?.params).toEqual({ mbps: 40, seconds: 2 });
    expect(gradeNetwork({ kind: 'ok', mbps: SLOW_UPLOAD_MBPS - 0.1 })[0]?.status).toBe('warn');
    expect(gradeNetwork({ kind: 'ok', mbps: SLOW_UPLOAD_MBPS })[0]?.status).toBe('pass');
    expect(gradeNetwork({ kind: 'error', code: 'offline' })[0]?.status).toBe('fail');
    expect(gradeNetwork({ kind: 'error', code: 'rate_limited' })[0]?.status).toBe('warn');
  });
});

describe('combining results', () => {
  it('a step is as good as its worst finding', () => {
    expect(worst([{ status: 'pass' }, { status: 'warn' }])).toBe('warn');
    expect(worst([{ status: 'warn' }, { status: 'fail' }, { status: 'pass' }])).toBe('fail');
    expect(worst([])).toBe('pass');
  });
  it('skipped steps do not count against the device', () => {
    expect(overall(['pass', 'skipped', 'skipped'])).toBe('pass');
    expect(overall(['pass', 'warn', 'skipped'])).toBe('warn');
    expect(overall(['skipped'])).toBe('pass');
    expect(overall(['fail', 'pass'])).toBe('fail');
  });
});
