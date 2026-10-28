import { describe, expect, it } from 'vitest';
import { HighSpeedWeb } from '../src/web';

describe('the plugin on the web (there is no high-speed recorder in a browser)', () => {
  const web = new HighSpeedWeb();

  it('reports that nothing is available, so a page can say so instead of failing', async () => {
    expect(await web.capabilities()).toEqual({
      available: false,
      platform: 'web',
      mime: '',
      codecs: [],
      motionSampling: false,
      lenses: [],
    });
    expect(await web.checkPermissions()).toEqual({ camera: 'prompt', microphone: 'prompt' });
    expect(await web.listRecordings()).toEqual({ recordings: [] });
  });

  it('rejects every call that would need a recorder, with the UNAVAILABLE code', async () => {
    const calls = [
      () => web.requestPermissions(),
      () => web.startPreview(),
      () => web.setMirrored(),
      () => web.startMotionSampling(),
      () => web.startRecording(),
      () => web.stopRecording(),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    }
  });

  it('has nothing to stop or delete, and says nothing about it', async () => {
    await expect(web.stopPreview()).resolves.toBeUndefined();
    await expect(web.stopMotionSampling()).resolves.toBeUndefined();
    await expect(web.deleteRecording()).resolves.toBeUndefined();
  });
});
