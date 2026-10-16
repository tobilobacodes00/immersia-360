'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, CircleDot, HardDrive, Settings2, Square, Upload, WifiOff } from 'lucide-react';
import {
  MotionTrigger,
  TakeRecorder,
  analyzeFrames,
  createFrameSampler,
  extensionFor,
  openCamera,
  openSimulatedCamera,
  pickRecordingMime,
  recordingBitrate,
  toCameraError,
  type OpenedCamera,
} from '@immersia/capture';
import {
  beginTake,
  boothDb,
  completeTake,
  failTake,
  importTake,
  noteChunk,
  recoverInterrupted,
  requestPersistence,
  storageHealth,
  takeStore,
  takesForEvent,
  type LocalTake,
  type TakeStore,
} from '@immersia/offline';
import { createOpfsWorker } from '@immersia/offline/opfs-worker';
import { workerUrl } from '@/lib/workers';
import { guestThemeVars, uuidv7, type EventTheme, type Video360Settings } from '@immersia/shared';
import { Pill, cx } from '@immersia/ui';
import { CountdownDisc, GuestButton, Headline, fade } from '@immersia/ui/guest';
import { readDeviceIdentity, type DeviceIdentity } from '@/lib/device-identity';
import { useCaptureKeys, useHeartbeat, useLiveQuery, useOnline, useWakeLock } from './booth-hooks';
import { RegisterDevice } from './RegisterDevice';
import { SettingsDrawer, readCameraChoice, type CameraChoice } from './SettingsDrawer';

export interface ActiveCamera {
  label: string;
  width: number;
  height: number;
  frameRate: number;
  torch: OpenedCamera['torch'];
}

export interface BoothEvent {
  id: string;
  name: string;
  video: Video360Settings;
  triggers: { tap: boolean; keyboard: boolean; motion: { enabled: boolean; threshold: number; cooldownS: number } };
  theme: EventTheme;
  attract: { headline: string; cta: string };
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'countdown'; remaining: number }
  | { kind: 'recording'; takeId: string; startedAt: number }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; code: string };

const PENDING: LocalTake['status'][] = ['recorded', 'interrupted', 'imported'];
const SAVED_HOLD_MS = 1400;

export function Booth360({ event }: { event: BoothEvent }) {
  const t = useTranslations('booth');
  const online = useOnline();
  const db = boothDb();
  // Client-only surface (loaded with ssr: false), so reading storage in initialisers is safe.
  const [identity, setIdentity] = useState<DeviceIdentity | null>(readDeviceIdentity);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [cameraChoice, setCameraChoice] = useState<CameraChoice>(readCameraChoice);
  const [activeCamera, setActiveCamera] = useState<ActiveCamera | null>(null);
  const [backend, setBackend] = useState<TakeStore['backend'] | null>(null);
  const [motionOn, setMotionOn] = useState(event.triggers.motion.enabled);
  const [threshold, setThreshold] = useState(event.triggers.motion.threshold);
  const [drawer, setDrawer] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [lowStorage, setLowStorage] = useState(false);
  const [recovered, setRecovered] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const camera = useRef<OpenedCamera | null>(null);
  const recorder = useRef<TakeRecorder | null>(null);
  const store = useRef<TakeStore | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const countdownTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  });

  const takes = useLiveQuery(() => takesForEvent(db, event.id), [event.id], [] as LocalTake[]);
  const pending = takes.filter((tk) => PENDING.includes(tk.status)).length;

  useWakeLock(phase.kind !== 'idle');
  useHeartbeat(
    identity?.token ?? null,
    () => ({ eventId: event.id, renderQueue: pending, uploadQueue: 0 }),
    () => setIdentity(null),
  );

  // On first open: recover takes a crash cut short. Reported straight away — never behind the
  // persistence request below, which some browsers leave pending indefinitely.
  useEffect(() => {
    let cancelled = false;
    void recoverInterrupted(db).then((r) => {
      if (!cancelled) setRecovered(r.length);
    });
    void (async () => {
      await Promise.race([requestPersistence(), new Promise((r) => setTimeout(r, 3000))]);
      const health = await storageHealth();
      if (!cancelled) setLowStorage(health.low);
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  // Guest screens are rem-scaled to the display and locked against scroll/zoom gestures.
  useEffect(() => {
    document.documentElement.classList.add('booth-active');
    return () => document.documentElement.classList.remove('booth-active');
  }, []);

  const stopCamera = useCallback(() => {
    camera.current?.stop();
    camera.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(
    () => () => {
      clearInterval(countdownTimer.current);
      clearTimeout(stopTimer.current);
      stopCamera();
    },
    [stopCamera],
  );

  const startCamera = useCallback(
    async (choice: CameraChoice) => {
      setPhase({ kind: 'starting' });
      stopCamera();
      try {
        store.current ??= await takeStore(() => createOpfsWorker(workerUrl('opfs')));
        setBackend(store.current.backend);
        const cam =
          choice.source === 'simulator'
            ? openSimulatedCamera({ resolution: event.video.resolution, frameRate: event.video.fps })
            : await openCamera({
                deviceId: choice.deviceId,
                resolution: event.video.resolution,
                frameRate: event.video.fps,
                audio: event.video.microphone,
              });
        camera.current = cam;
        setActiveCamera({
          label: cam.label,
          width: cam.settings.width,
          height: cam.settings.height,
          frameRate: cam.settings.frameRate,
          torch: cam.torch,
        });
        cam.track.addEventListener('ended', () => setPhase({ kind: 'error', code: 'lost' }));
        const v = videoRef.current;
        if (v) {
          v.srcObject = cam.stream;
          await v.play().catch(() => undefined);
        }
        setPhase({ kind: 'ready' });
      } catch (err) {
        setPhase({ kind: 'error', code: toCameraError(err).code });
      }
    },
    [event.video, stopCamera],
  );

  const finishRecording = useCallback(async () => {
    clearTimeout(stopTimer.current);
    const rec = recorder.current;
    const current = phaseRef.current;
    if (!rec || current.kind !== 'recording') return;
    recorder.current = null;
    setPhase({ kind: 'saving' });
    const take = await db.takes.get(current.takeId);
    try {
      const result = await rec.stop();
      if (take) await store.current?.finish(take.path);
      await completeTake(db, current.takeId, result.durationMs);
    } catch (err) {
      // Data up to the failure is on disk; keep the take but flag it for the operator.
      setWarning(t('warnings.storage'));
      if (take && take.chunks > 0) await completeTake(db, current.takeId, take.durationMs);
      else await failTake(db, current.takeId, String(err));
    }
    setPhase({ kind: 'saved' });
    setTimeout(() => setPhase((p) => (p.kind === 'saved' ? { kind: 'ready' } : p)), SAVED_HOLD_MS);
  }, [db, t]);

  const record = useCallback(
    async (source: 'tap' | 'keyboard' | 'motion') => {
      const cam = camera.current;
      const s = store.current;
      if (!cam || !s || !identity) return;
      // Some engines (e.g. WebKitGTK) have no MediaRecorder at all: explain instead of throwing.
      const mime =
        typeof MediaRecorder === 'undefined' ? null : pickRecordingMime((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) return setPhase({ kind: 'error', code: 'recording_unsupported' });
      const takeId = uuidv7();
      const path = `takes/${event.id}/${takeId}.${extensionFor(mime)}`;
      await beginTake(db, {
        id: takeId,
        eventId: event.id,
        deviceId: identity.id,
        path,
        mimeType: mime.split(';')[0]!,
        trigger: source,
        width: cam.settings.width,
        height: cam.settings.height,
        fps: cam.settings.frameRate,
      });
      await s.begin(path);
      const rec = new TakeRecorder(cam.stream, {
        mimeType: mime,
        videoBitsPerSecond: recordingBitrate(cam.settings.width, cam.settings.height, cam.settings.frameRate),
        onChunk: async (chunk) => {
          await s.append(path, chunk);
          await noteChunk(db, takeId, chunk.size, rec.elapsedMs);
        },
        onError: () => setWarning(t('warnings.storage')),
      });
      recorder.current = rec;
      rec.start();
      setPhase({ kind: 'recording', takeId, startedAt: performance.now() });
      // CAP-5: auto-stop at the spin length.
      stopTimer.current = setTimeout(() => void finishRecording(), event.video.spinSeconds * 1000);
    },
    [db, event.id, event.video.spinSeconds, finishRecording, identity, t],
  );

  const trigger = useCallback(
    (source: 'tap' | 'keyboard' | 'motion') => {
      if (phaseRef.current.kind !== 'ready') return;
      // The platform is already turning on a motion start: no countdown.
      const seconds = source === 'motion' ? 0 : event.video.countdownSeconds;
      if (seconds === 0) return void record(source);
      let remaining = seconds;
      setPhase({ kind: 'countdown', remaining });
      clearInterval(countdownTimer.current);
      countdownTimer.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(countdownTimer.current);
          void record(source);
        } else setPhase({ kind: 'countdown', remaining });
      }, 1000);
    },
    [event.video.countdownSeconds, record],
  );

  useCaptureKeys(event.triggers.keyboard && phase.kind === 'ready', () => trigger('keyboard'));

  // Stop early with End or Escape (operator).
  useEffect(() => {
    if (phase.kind !== 'recording') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'End' || e.key === 'Escape') void finishRecording();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase.kind, finishRecording]);

  // Elapsed time for the recording indicator.
  useEffect(() => {
    if (phase.kind !== 'recording') return;
    const start = phase.startedAt;
    const id = setInterval(() => setElapsed((performance.now() - start) / 1000), 100);
    return () => clearInterval(id);
  }, [phase]);

  // Motion trigger (CAP-4): ~10 samples a second while ready.
  useEffect(() => {
    if (!motionOn || phase.kind !== 'ready') return;
    const v = videoRef.current;
    if (!v) return;
    const sample = createFrameSampler();
    const trig = new MotionTrigger({ threshold });
    let prev: Uint8Array | null = null;
    let cooldownUntil = 0;
    const id = setInterval(() => {
      if (v.readyState < 2) return;
      const frame = sample(v);
      if (prev && performance.now() > cooldownUntil && trig.update(analyzeFrames(prev, frame))) {
        cooldownUntil = performance.now() + event.triggers.motion.cooldownS * 1000;
        trigger('motion');
      }
      prev = frame;
    }, 100);
    return () => clearInterval(id);
  }, [motionOn, threshold, phase.kind, trigger, event.triggers.motion.cooldownS]);

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      store.current ??= await takeStore(() => createOpfsWorker(workerUrl('opfs')));
      setBackend(store.current.backend);
      const s = store.current;
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('video/')) continue;
        const meta = await videoMetadata(file);
        const id = uuidv7();
        const ext = file.name.split('.').pop()?.toLowerCase() || extensionFor(file.type);
        const path = `takes/${event.id}/${id}.${ext}`;
        await s.begin(path);
        // Stream in 8 MB slices: a 4K import never has to fit in memory at once.
        for (let at = 0; at < file.size; at += 8 * 1024 * 1024)
          await s.append(path, file.slice(at, at + 8 * 1024 * 1024));
        await s.finish(path);
        await importTake(db, {
          id,
          eventId: event.id,
          deviceId: identity?.id ?? null,
          path,
          mimeType: file.type,
          bytes: file.size,
          durationMs: meta.durationMs,
          width: meta.width,
          height: meta.height,
          fps: 0,
        });
      }
    },
    [db, event.id, identity?.id],
  );

  const themeVars = useMemo(() => guestThemeVars(event.theme), [event.theme]);
  const spin = event.video.spinSeconds;
  const live = phase.kind === 'ready' || phase.kind === 'countdown' || phase.kind === 'recording';

  if (!identity) {
    return (
      <div className="fixed inset-0 bg-g-bg text-g-ink" style={themeVars}>
        <RegisterDevice onRegistered={setIdentity} />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-g-bg text-g-ink"
      style={themeVars}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
      }}
    >
      {/* Live preview: full bleed, mirrored only on screen if the operator asked (recording is not). */}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        aria-hidden
        className={cx(
          'absolute inset-0 size-full object-cover transition-opacity duration-300',
          live ? 'opacity-100' : 'opacity-0',
          cameraChoice.mirror && '-scale-x-100',
        )}
      />

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-[1.25rem]">
        <Link
          href={`/studio/events/${event.id}`}
          className="focus-ring flex items-center gap-2 rounded-full bg-g-bg/95 py-2 pr-4 pl-3 text-[0.95rem] font-semibold"
        >
          <ArrowLeft className="size-5" aria-hidden />
          <span className="max-w-[40vw] truncate">{event.name}</span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2" role="status" aria-live="polite">
          {!online && (
            <Pill tone="warn" className="text-[0.8rem]">
              <WifiOff className="size-3.5" aria-hidden /> {t('offline')}
            </Pill>
          )}
          {lowStorage && (
            <Pill tone="bad" className="text-[0.8rem]">
              <HardDrive className="size-3.5" aria-hidden /> {t('lowStorage')}
            </Pill>
          )}
          {motionOn && live && (
            <Pill tone="info" dot className="text-[0.8rem]">
              {t('motionArmed')}
            </Pill>
          )}
          <Pill className="text-[0.8rem]">{t('queue', { count: pending })}</Pill>
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label={t('settings.title')}
            className="focus-ring grid size-11 place-items-center rounded-full bg-g-bg/95"
          >
            <Settings2 className="size-5" />
          </button>
        </div>
      </div>

      {(warning || recovered > 0) && (
        <div className="absolute inset-x-0 top-[5.5rem] z-20 flex justify-center px-4">
          <div role="alert" className="card max-w-xl px-4 py-3 text-sm text-fg">
            {warning ?? t('recovered', { count: recovered })}
            <button
              type="button"
              className="ml-3 font-semibold text-accent"
              onClick={() => {
                setWarning(null);
                setRecovered(0);
              }}
            >
              {t('dismiss')}
            </button>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {phase.kind === 'idle' && (
          <motion.div key="idle" {...fade} className="absolute inset-0 grid place-items-center px-6 text-center">
            <div className="flex flex-col items-center">
              <Headline font={event.theme.font} className="text-[clamp(3rem,8vw,7rem)]">
                {event.name}
              </Headline>
              <p className="mt-4 text-[1.2rem] opacity-70">{t('startHint')}</p>
              <GuestButton primary className="mt-10" onClick={() => void startCamera(cameraChoice)}>
                {t('startBooth')}
              </GuestButton>
            </div>
          </motion.div>
        )}

        {phase.kind === 'starting' && (
          <motion.div key="starting" {...fade} className="absolute inset-0 grid place-items-center">
            <p className="rounded-full bg-g-bg px-6 py-3 text-[1.2rem] font-semibold">{t('startingCamera')}</p>
          </motion.div>
        )}

        {phase.kind === 'ready' && (
          <motion.div
            key="ready"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-4 rounded-t-[2rem] bg-g-bg px-6 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-center"
          >
            <Headline font={event.theme.font} className="text-[clamp(2.25rem,5vw,4rem)]">
              {event.attract.headline}
            </Headline>
            {event.triggers.tap && (
              <GuestButton primary className="min-w-[16rem]" onClick={() => trigger('tap')}>
                <CircleDot className="size-6" aria-hidden /> {event.attract.cta}
              </GuestButton>
            )}
            {motionOn && <p className="text-[1rem] opacity-70">{t('motionHint')}</p>}
          </motion.div>
        )}

        {phase.kind === 'countdown' && (
          <motion.div key="countdown" {...fade} className="absolute inset-0 z-10 grid place-items-center">
            <CountdownDisc
              count={phase.remaining}
              total={event.video.countdownSeconds}
              font={event.theme.font}
              label={t('countdown', { count: phase.remaining })}
            />
          </motion.div>
        )}

        {phase.kind === 'recording' && (
          <motion.div key="recording" {...fade} className="absolute inset-0 z-10">
            {/* CAP-8: unmistakable to guests and the operator alike. */}
            <div className="absolute inset-x-0 top-[5.5rem] flex justify-center">
              <div
                role="status"
                aria-label={t('recording')}
                className="flex items-center gap-3 rounded-full bg-bad px-6 py-3 text-[1.3rem] font-bold text-white"
              >
                <span className="relative flex size-3">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-70 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-3 rounded-full bg-white" />
                </span>
                {t('rec')}
                <span className="tabular">{Math.max(0, spin - elapsed).toFixed(0)}s</span>
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-2 bg-g-ink/20">
              <div
                className="h-full bg-bad transition-[width] duration-100 ease-linear"
                style={{ width: `${Math.min(100, (elapsed / spin) * 100)}%` }}
              />
            </div>
            <button
              type="button"
              onClick={() => void finishRecording()}
              className="focus-ring absolute right-[1.25rem] bottom-[2rem] flex items-center gap-2 rounded-full bg-g-bg px-5 py-3 text-[1rem] font-semibold"
            >
              <Square className="size-4 fill-current" aria-hidden /> {t('stopEarly')}
            </button>
          </motion.div>
        )}

        {(phase.kind === 'saving' || phase.kind === 'saved') && (
          <motion.div key="saved" {...fade} className="absolute inset-0 z-10 grid place-items-center bg-g-bg">
            <div className="flex flex-col items-center gap-5" role="status">
              <span className="grid size-24 place-items-center rounded-full bg-g-accent text-g-on-accent">
                {phase.kind === 'saved' ? (
                  <Check className="size-12" strokeWidth={3} aria-hidden />
                ) : (
                  <span className="size-6 animate-pulse rounded-full bg-current" />
                )}
              </span>
              <Headline font={event.theme.font} className="text-[clamp(2.5rem,6vw,5rem)]">
                {phase.kind === 'saved' ? t('saved') : t('saving')}
              </Headline>
            </div>
          </motion.div>
        )}

        {phase.kind === 'error' && (
          <motion.div key="error" {...fade} className="absolute inset-0 z-10 grid place-items-center px-6">
            <div className="card max-w-md p-6 text-fg" role="alert">
              <h2 className="text-lg font-semibold">{t('errors.title')}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t(`errors.${errorKey(phase.code)}`)}</p>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  className="focus-ring rounded-[10px] bg-ink px-4 py-2 text-sm font-semibold text-white"
                  onClick={() => void startCamera(cameraChoice)}
                >
                  {t('errors.retry')}
                </button>
                <button
                  type="button"
                  className="focus-ring rounded-[10px] border border-line-strong bg-elev px-4 py-2 text-sm font-medium"
                  onClick={() => setDrawer(true)}
                >
                  {t('settings.title')}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <SettingsDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        choice={cameraChoice}
        onChoice={(c) => {
          setCameraChoice(c);
          if (phase.kind !== 'idle' && phase.kind !== 'recording') void startCamera(c);
        }}
        camera={activeCamera}
        motion={{ enabled: motionOn, threshold }}
        onMotion={(m) => {
          setMotionOn(m.enabled);
          setThreshold(m.threshold);
        }}
        takes={takes}
        onImport={importFiles}
        storeBackend={backend}
        importIcon={<Upload className="size-4" />}
      />
    </div>
  );
}

const ERROR_KEYS = new Set([
  'permission',
  'not_found',
  'in_use',
  'overconstrained',
  'insecure',
  'lost',
  'recording_unsupported',
]);
const errorKey = (code: string) => (ERROR_KEYS.has(code) ? code : 'unknown');

function videoMetadata(file: File): Promise<{ durationMs: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (meta: { durationMs: number; width: number; height: number }) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    v.onloadedmetadata = () =>
      done({
        durationMs: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0,
        width: v.videoWidth,
        height: v.videoHeight,
      });
    v.onerror = () => done({ durationMs: 0, width: 0, height: 0 });
    v.src = url;
  });
}
