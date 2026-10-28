'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations, type Messages } from 'next-intl';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Camera, Images, Printer, RotateCcw, Settings2, WifiOff } from 'lucide-react';
import { openCamera, openSimulatedCamera, toCameraError, type OpenedCamera } from '@immersia/capture';
import {
  boothDb,
  mintSession,
  putOutput,
  optOutOfDisplay,
  queueEmail,
  takeStore,
  type LocalSession,
  type TakeStore,
} from '@immersia/offline';
import { createOpfsWorker } from '@immersia/offline/opfs-worker';
import { encodeGif, presetTemplate, renderToBlob, type Template } from '@immersia/layout';
import { browserPrint } from '@immersia/layout/print';
import { RenderClient } from '@immersia/render-engine/client';
import {
  PRINT_SIZE_INCHES,
  canvasSizeFor,
  eventTokens,
  guestThemeVars,
  sessionUrl,
  type EventTheme,
  type PhotoSettings,
} from '@immersia/shared';
import { Pill } from '@immersia/ui';
import { CountdownDisc, GuestButton, Headline, fade } from '@immersia/ui/guest';
import { readDeviceIdentity, type DeviceIdentity } from '@/lib/device-identity';
import { workerUrl } from '@/lib/workers';
import { useCaptureKeys, useHeartbeat, useOnline, useWakeLock } from './booth-hooks';
import type { AssetView } from '@/server/assets';
import { fillAssets } from './event-assets';
import { fitted, templateResources } from './media';
import { Confetti } from './Confetti';
import { Gallery } from './Gallery';
import { KioskLockLayer, useKioskLock } from './KioskLock';
import { MotionBuffer } from './motion-buffer';
import { RegisterDevice } from './RegisterDevice';
import { ResultScreen } from './ResultScreen';
import { SettingsDrawer, readCameraChoice, type CameraChoice } from './SettingsDrawer';
import type { ActiveCamera } from './Booth360';
import { useUploadQueue } from './use-upload-queue';

export interface PhotoBoothEvent {
  id: string;
  name: string;
  /** ISO date, for the strip's date field. */
  date: string;
  photo: PhotoSettings;
  triggers: { tap: boolean; keyboard: boolean };
  theme: EventTheme;
  attract: { headline: string; cta: string };
  kioskPinHash: string | null;
  share: { qr: boolean; email: boolean; sms: boolean; whatsapp: boolean; stripQr: boolean };
  /** The event's print layout from the editor (screen 6), or null for the preset one. */
  layout: Template | null;
  /** LIV-8: guests are told their capture may appear on the Live Display, and can opt out. */
  liveDisplay: boolean;
  /** Dynamic fields and every file the layout draws (screen 5). */
  media: { branding: { hashtag: string; custom1: string; custom2: string; custom3: string }; assets: AssetView[] };
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'countdown'; shot: number; remaining: number }
  | { kind: 'flash'; shot: number }
  | { kind: 'review'; preview: string }
  | { kind: 'making' }
  /** `strip`: the kept strip at print resolution, for the guest's reprints. */
  | { kind: 'result'; session: LocalSession; preview: string; strip: Blob }
  | { kind: 'error'; code: string };

/** Frames per second of the motion clips (PHO-2). */
const CLIP_FPS = 12;
/** An unattended review keeps the strip after this long. */
const REVIEW_TIMEOUT_MS = 20_000;
const ARMED: Phase['kind'][] = ['ready', 'result'];

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Screens 11 and 12: the photo booth. One to four shots with a countdown, a strip preview revealed
 * with confetti, retake or keep; then the guest's QR and code, prints, and the GIF / boomerang /
 * short video made in the background (PHO-1, 2, 3, 7, 8, 11; KIO-1, 2).
 */
export function PhotoBooth({ event }: { event: PhotoBoothEvent }) {
  const t = useTranslations('booth');
  const tp = useTranslations('booth.photo');
  const online = useOnline();
  const db = boothDb();
  const [identity, setIdentity] = useState<DeviceIdentity | null>(readDeviceIdentity);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [cameraChoice, setCameraChoice] = useState<CameraChoice>(readCameraChoice);
  const [activeCamera, setActiveCamera] = useState<ActiveCamera | null>(null);
  const [store, setStore] = useState<TakeStore | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [printsLeft, setPrintsLeft] = useState(0);
  const [printing, setPrinting] = useState(false);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const camera = useRef<OpenedCamera | null>(null);
  const motionBuffer = useRef<MotionBuffer | null>(null);
  const renderer = useRef<RenderClient | null>(null);
  const shots = useRef<{ still: ImageBitmap; clip: Promise<ImageBitmap[]> | null }[]>([]);
  const keepTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const p = event.photo;
  const wantsClips = p.outputs.boomerang || p.outputs.shortVideo;
  const kiosk = useKioskLock(event.kioskPinHash);
  // A session is under way, from the first countdown until the strip is kept: the gallery stays out of its way.
  const capturing =
    phase.kind === 'starting' ||
    phase.kind === 'countdown' ||
    phase.kind === 'flash' ||
    phase.kind === 'review' ||
    phase.kind === 'making';
  const closeGallery = useCallback(() => setGalleryOpen(false), []);
  const uploads = useUploadQueue({ eventId: event.id, token: identity?.token ?? null, store });
  useWakeLock(phase.kind !== 'idle');
  useHeartbeat(
    identity?.token ?? null,
    () => ({ eventId: event.id, renderQueue: 0, uploadQueue: uploads.status.waiting }),
    () => setIdentity(null),
  );

  useEffect(() => {
    document.documentElement.classList.add('booth-active');
    renderer.current = new RenderClient(() => new Worker(workerUrl('render'), { type: 'module' }));
    return () => {
      document.documentElement.classList.remove('booth-active');
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, []);

  const releaseShots = useCallback(() => {
    for (const s of shots.current) {
      s.still.close();
      void s.clip?.then((frames) => frames.forEach((f) => f.close()));
    }
    shots.current = [];
  }, []);

  const stopCamera = useCallback(() => {
    motionBuffer.current?.stop();
    motionBuffer.current = null;
    camera.current?.stop();
    camera.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(
    () => () => {
      clearTimeout(keepTimer.current);
      stopCamera();
    },
    [stopCamera],
  );

  const startCamera = useCallback(
    async (choice: CameraChoice) => {
      setPhase({ kind: 'starting' });
      stopCamera();
      try {
        const s = await takeStore(() => createOpfsWorker(workerUrl('opfs')));
        setStore(s);
        const cam =
          choice.source === 'simulator'
            ? openSimulatedCamera({ resolution: '1080p', frameRate: 30 })
            : await openCamera({ deviceId: choice.deviceId, resolution: '1080p', frameRate: 30, audio: false });
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
          if (wantsClips) {
            motionBuffer.current = new MotionBuffer(v, CLIP_FPS);
            motionBuffer.current.start();
          }
        }
        setPhase({ kind: 'ready' });
      } catch (err) {
        setPhase({ kind: 'error', code: toCameraError(err).code });
      }
    },
    [stopCamera, wantsClips],
  );

  // The event's own layout (fitted to the print size it has now), or the preset; no QR if the
  // operator turned the strip QR off (DL-3).
  const design = useMemo(() => {
    const { width, height } = canvasSizeFor(p.printSize);
    const base = event.layout
      ? fitted(event.layout, width, height)
      : presetTemplate(p.printSize, {
          shots: p.shots as 1 | 2 | 3 | 4,
          background: event.theme.background,
          ink: event.theme.ink,
          font: event.theme.font,
        });
    return event.share.stripQr ? base : { ...base, elements: base.elements.filter((e) => e.type !== 'qr') };
  }, [event.layout, event.share.stripQr, event.theme, p.printSize, p.shots]);
  // Fonts and images for it, from the device's offline cache; prepared as soon as the booth opens.
  const resources = useMemo(() => {
    let ready: ReturnType<typeof templateResources> | null = null;
    return () => (ready ??= fillAssets(event.media.assets).then(() => templateResources(design)));
  }, [design, event.media.assets]);
  useEffect(() => {
    void resources();
  }, [resources]);

  /** The strip at print resolution (or a quick half-scale preview). */
  const composeStrip = useCallback(
    async (session: LocalSession | null, scale: number) => {
      const origin = window.location.origin;
      const link = session ? sessionUrl(origin, session.linkId, 'print') : '';
      return renderToBlob(
        design,
        {
          photos: shots.current.map((s) => s.still),
          tokens: eventTokens(
            { name: event.name, date: event.date },
            event.media.branding,
            session ? { shortCode: session.shortCode ?? '', url: link } : null,
            { number: shots.current.length, count: p.shots },
          ),
          // The preview shows where the QR goes; the kept strip carries the guest's own link.
          qr: session ? { url: link, code: session.shortCode } : null,
          placeholders: !session,
          ...(await resources()),
        },
        { scale, type: 'image/jpeg', quality: 0.92 },
      );
    },
    [design, event.name, event.date, event.media.branding, p.shots, resources],
  );

  const print = useCallback(
    async (image: Blob) => {
      const inches = PRINT_SIZE_INCHES[p.printSize];
      if (!p.print.enabled || !inches) return;
      setPrinting(true);
      try {
        await browserPrint({
          image,
          widthIn: inches[0],
          heightIn: inches[1],
          copies: p.print.copies,
          twoUp: p.print.doubleStrip && p.printSize === '2x6',
        });
        setPrintsLeft((n) => Math.max(0, n - 1));
      } catch (err) {
        console.warn('[print]', err);
      } finally {
        setPrinting(false);
      }
    },
    [p],
  );

  /** PHO-2 extras, made after the guest already has their QR: GIF, boomerang, short video. */
  const makeExtras = useCallback(
    async (session: LocalSession) => {
      const s = store;
      if (!s) return;
      const taken = shots.current;
      shots.current = [];
      const save = async (
        kind: 'gif' | 'boomerang' | 'short_video',
        blob: Blob,
        width: number,
        height: number,
        durationMs: number,
      ) => {
        await putOutput(db, s, {
          takeId: null,
          sessionId: session.id,
          eventId: event.id,
          kind,
          blob,
          width,
          height,
          durationMs,
        });
        uploads.nudgeSession(session.id);
      };
      try {
        if (p.outputs.gif) {
          const w = 480;
          const h = Math.round((w * taken[0]!.still.height) / taken[0]!.still.width);
          const gif = await encodeGif(
            taken.map((x) => ({ image: x.still, delayMs: 700 })),
            w,
            h,
          );
          await save('gif', gif, w, h, taken.length * 700);
        }
        const clips = await Promise.all(taken.map((x) => x.clip ?? Promise.resolve([] as ImageBitmap[])));
        const client = renderer.current;
        if (client && p.outputs.boomerang && clips.at(-1)?.length) {
          // The last shot's moment, forward and back. The worker takes ownership of the frames it
          // gets, so when the short video also needs them, the boomerang gets copies.
          const last = clips.at(-1)!;
          const frames = p.outputs.shortVideo ? await Promise.all(last.map((f) => createImageBitmap(f))) : last;
          const { width, height } = frames[0]!;
          const mp4 = await client.clip(`${session.id}:boomerang`, frames, CLIP_FPS, true);
          if (!p.outputs.shortVideo) clips[clips.length - 1] = [];
          await save('boomerang', mp4, width, height, Math.round(((frames.length * 2 - 2) / CLIP_FPS) * 1000));
        }
        const all = clips.flat();
        if (client && p.outputs.shortVideo && all.length) {
          const { width, height } = all[0]!;
          const mp4 = await client.clip(`${session.id}:short`, all, CLIP_FPS, false);
          await save('short_video', mp4, width, height, Math.round((all.length / CLIP_FPS) * 1000));
        } else all.forEach((f) => f.close());
      } catch (err) {
        console.warn('[photo extras]', err);
      } finally {
        for (const x of taken) x.still.close();
      }
    },
    [db, event.id, p.outputs, store, uploads],
  );

  const keep = useCallback(async () => {
    clearTimeout(keepTimer.current);
    if (phaseRef.current.kind !== 'review') return;
    const s = store;
    if (!s) return;
    setPhase({ kind: 'making' });
    const session = await mintSession(db, { eventId: event.id, takeIds: [], capturedAt: Date.now() });
    const image = await composeStrip(session, 1);
    const { width, height } = canvasSizeFor(p.printSize);
    await putOutput(db, s, {
      takeId: null,
      sessionId: session.id,
      eventId: event.id,
      kind: 'strip',
      blob: image,
      width,
      height,
      durationMs: 0,
    });
    uploads.nudgeSession(session.id);
    setPrintsLeft(p.print.enabled ? p.print.maxGuestCopies : 0);
    setPhase({ kind: 'result', session, preview: URL.createObjectURL(image), strip: image });
    if (p.print.enabled && p.print.autoPrint) void print(image);
    void makeExtras(session);
  }, [composeStrip, db, event.id, makeExtras, p, print, store, uploads]);

  /** One session: every shot with its countdown, then the reveal. */
  const runSession = useCallback(
    async (force = false) => {
      if (!force && !ARMED.includes(phaseRef.current.kind)) return;
      const v = videoRef.current;
      if (!v) return;
      releaseShots();
      for (let shot = 0; shot < p.shots; shot++) {
        let remaining = shot === 0 ? p.countdownSeconds : Math.round(p.secondsBetweenShots);
        while (remaining > 0) {
          setPhase({ kind: 'countdown', shot, remaining });
          await wait(1000);
          remaining--;
        }
        // The clip around this shot starts from the buffered second before it (PHO-2).
        const clip = motionBuffer.current ? motionBuffer.current.clip(500) : null;
        const still = await createImageBitmap(v);
        shots.current.push({ still, clip });
        setPhase({ kind: 'flash', shot });
        await wait(450);
      }
      const preview = URL.createObjectURL(await composeStrip(null, 0.5));
      setPhase({ kind: 'review', preview });
      clearTimeout(keepTimer.current);
      keepTimer.current = setTimeout(() => void keep(), REVIEW_TIMEOUT_MS);
    },
    [composeStrip, keep, p, releaseShots],
  );

  const retake = () => {
    clearTimeout(keepTimer.current);
    if (phaseRef.current.kind === 'review') URL.revokeObjectURL(phaseRef.current.preview);
    releaseShots();
    void runSession(true);
  };

  const backToReady = useCallback(() => {
    setPhase((cur) => {
      if (cur.kind === 'result') URL.revokeObjectURL(cur.preview);
      return cur.kind === 'result' ? { kind: 'ready' } : cur;
    });
  }, []);

  useCaptureKeys(event.triggers.keyboard && ARMED.includes(phase.kind), () => void runSession());

  const themeVars = useMemo(() => guestThemeVars(event.theme), [event.theme]);

  if (!identity) {
    return (
      <div style={themeVars} className="fixed inset-0 overflow-auto bg-g-bg text-g-ink">
        <RegisterDevice onRegistered={setIdentity} />
      </div>
    );
  }

  const mirrored = cameraChoice.mirror ? '-scale-x-100' : '';

  return (
    <div style={themeVars} className="fixed inset-0 overflow-hidden bg-[#111110] text-g-ink select-none">
      <video ref={videoRef} muted playsInline className={`absolute inset-0 size-full object-cover ${mirrored}`} />

      {/* Top bar: operator controls hide in kiosk mode. */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-[1.25rem]">
        {kiosk.locked ? (
          <span className="rounded-full bg-g-bg/95 px-4 py-2 text-[0.95rem] font-semibold">{event.name}</span>
        ) : (
          <Link
            href={`/studio/events/${event.id}`}
            className="focus-ring flex items-center gap-2 rounded-full bg-g-bg/95 py-2 pr-4 pl-3 text-[0.95rem] font-semibold"
          >
            <ArrowLeft className="size-5" aria-hidden />
            <span className="max-w-[40vw] truncate">{event.name}</span>
          </Link>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2" role="status" aria-live="polite">
          {!online && (
            <Pill tone="warn" className="text-[0.8rem]">
              <WifiOff className="size-3.5" aria-hidden /> {t('offline')}
            </Pill>
          )}
          {uploads.status.waiting > 0 && (
            <Pill tone={online ? 'neutral' : 'warn'} className="text-[0.8rem]">
              {online
                ? t('uploads.waiting', { count: uploads.status.waiting })
                : t('uploads.offline', { count: uploads.status.waiting })}
            </Pill>
          )}
          {!kiosk.locked && (
            <>
              <button
                type="button"
                onClick={() => setGalleryOpen(true)}
                aria-label={t('gallery.open')}
                className="focus-ring grid size-11 place-items-center rounded-full bg-g-bg/95"
              >
                <Images className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => setDrawer(true)}
                aria-label={t('settings.title')}
                className="focus-ring grid size-11 place-items-center rounded-full bg-g-bg/95"
              >
                <Settings2 className="size-5" />
              </button>
            </>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {phase.kind === 'idle' && (
          <motion.div
            key="idle"
            {...fade}
            className="absolute inset-0 grid place-items-center bg-g-bg px-6 text-center"
          >
            <div className="flex flex-col items-center">
              <Headline font={event.theme.font} className="text-[clamp(3rem,8vw,7rem)]">
                {event.name}
              </Headline>
              <p className="mt-4 text-[1.2rem] opacity-70">{t('startHint')}</p>
              <GuestButton
                primary
                className="mt-10"
                onClick={() => {
                  void kiosk.enter();
                  void startCamera(cameraChoice);
                }}
              >
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

        {/* Screen 12: attract, over the live preview. */}
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
              <GuestButton primary className="min-w-[16rem]" onClick={() => void runSession()}>
                <Camera className="size-6" aria-hidden /> {event.attract.cta}
              </GuestButton>
            )}
          </motion.div>
        )}

        {phase.kind === 'countdown' && (
          <motion.div key="countdown" {...fade} className="absolute inset-0 z-10 grid place-items-center">
            <div className="flex flex-col items-center gap-6">
              <Pill className="bg-g-bg text-[1rem]">{tp('shotCounter', { n: phase.shot + 1, total: p.shots })}</Pill>
              <CountdownDisc
                count={phase.remaining}
                total={phase.shot === 0 ? p.countdownSeconds : Math.max(1, Math.round(p.secondsBetweenShots))}
                font={event.theme.font}
                label={t('countdown', { seconds: phase.remaining })}
              />
            </div>
          </motion.div>
        )}

        {phase.kind === 'flash' && (
          <motion.div
            key={`flash-${phase.shot}`}
            initial={{ opacity: 0.95 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.45 }}
            className="absolute inset-0 z-10 bg-white"
            role="status"
            aria-label={tp('flash')}
          />
        )}

        {phase.kind === 'review' && (
          <motion.div key="review" {...fade} className="absolute inset-0 z-10 grid place-items-center bg-g-bg px-6">
            <Confetti accent={event.theme.accent} />
            <div className="flex flex-col items-center gap-6 landscape:flex-row landscape:gap-12">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
              <img
                src={phase.preview}
                alt={t('result.previewAlt')}
                className="max-h-[70vh] w-auto max-w-[min(24rem,80vw)] rounded-[0.75rem] shadow-pop"
              />
              <div className="flex flex-col items-center gap-4 text-center">
                <Headline font={event.theme.font} className="text-[clamp(2.25rem,5vw,3.75rem)]">
                  {tp('lookingGood')}
                </Headline>
                <GuestButton primary className="min-w-[14rem]" onClick={() => void keep()}>
                  {tp('keep')}
                </GuestButton>
                {p.retake && (
                  <GuestButton className="min-w-[14rem]" onClick={retake}>
                    <RotateCcw className="size-6" aria-hidden /> {tp('retake')}
                  </GuestButton>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {phase.kind === 'making' && (
          <motion.div key="making" {...fade} className="absolute inset-0 z-10 grid place-items-center bg-g-bg">
            <p role="status" className="text-[1.4rem] font-semibold">
              {tp('making')}
            </p>
          </motion.div>
        )}

        {phase.kind === 'result' && (
          <ResultScreen
            key={phase.session.id}
            kind="photo"
            session={phase.session}
            preview={phase.preview}
            event={{ name: event.name, font: event.theme.font, share: event.share }}
            onEmail={(email) => queueEmail(db, phase.session.id, email)}
            liveDisplay={event.liveDisplay}
            onOptOut={() => optOutOfDisplay(db, phase.session.id).then(() => uploads.nudgeSession(phase.session.id))}
            onDone={backToReady}
            actions={
              p.print.enabled ? (
                <GuestButton
                  className="min-w-[12rem]"
                  disabled={printing || printsLeft === 0}
                  onClick={() => void print(phase.strip)}
                >
                  <Printer className="size-6" aria-hidden />
                  {printing ? tp('printing') : printsLeft === 0 ? tp('printLimit') : tp('print')}
                </GuestButton>
              ) : null
            }
          />
        )}

        {phase.kind === 'error' && (
          <motion.div key="error" {...fade} className="absolute inset-0 z-10 grid place-items-center bg-g-bg px-6">
            <div role="alert" className="max-w-md text-center">
              <h2 className="text-[1.6rem] font-bold">{t('errors.title')}</h2>
              <p className="mt-2 opacity-70">{t(`errors.${errorKey(phase.code)}`)}</p>
              <GuestButton primary className="mt-6" onClick={() => void startCamera(cameraChoice)}>
                {t('errors.retry')}
              </GuestButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Gallery
        open={galleryOpen && !kiosk.locked}
        onClose={closeGallery}
        eventId={event.id}
        eventName={event.name}
        capturing={capturing}
      />

      <SettingsDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        choice={cameraChoice}
        onChoice={(c) => {
          setCameraChoice(c);
          if (phase.kind !== 'idle') void startCamera(c);
        }}
        camera={activeCamera}
      />

      <KioskLockLayer eventId={event.id} pinHash={event.kioskPinHash} kiosk={kiosk} />
    </div>
  );
}

type CameraErrorKey = keyof Messages['booth']['errors'];
const ERROR_KEYS = new Set<string>(['permission', 'not_found', 'in_use', 'overconstrained', 'insecure', 'lost']);
const errorKey = (code: string): CameraErrorKey => (ERROR_KEYS.has(code) ? (code as CameraErrorKey) : 'unknown');
