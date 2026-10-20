/**
 * Lens choice and zoom (CAP-2). Browsers expose each physical or logical lens of a phone as its own
 * video input, named by the OS in the user's language, so the booth classifies the label (and the
 * facing mode, where a track reports one) into something it can group, sort and name itself.
 */
import { applyAdvanced, capabilitiesOf, settingsOf, type ConstrainableTrack } from './track';

export type LensFacing = 'front' | 'back' | 'external' | 'unknown';
export type LensKind = 'wide' | 'ultra-wide' | 'telephoto' | 'dual' | 'triple' | 'unknown';

export interface LensClass {
  facing: LensFacing;
  kind: LensKind;
}

export interface Lens extends LensClass {
  deviceId: string;
  /** The browser's own name for it; empty until camera permission has been granted. */
  label: string;
  /** 1-based position in the browser's list, for naming cameras the OS leaves unnamed. */
  position: number;
}

/** Lower case, accents and punctuation gone, so "Câmera Traseira Ultra-Angular" is plain words. */
function fold(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .trim();
}

// iOS names its cameras in the phone's language ("Cámara trasera ultra gran angular"), so every word
// list below is matched by stem: word order, gender and hyphenation don't matter. English, Spanish,
// Portuguese and French are the booth's languages; German and Italian are best-effort.
const FRONT_WORD = /\b(?:front\w*|facetime|selfie|user|anterior\w*|avant|frente|delantera|vorder\w*|vorn\w*)\b/;
const BACK_WORD = /\b(?:back|rear|environment|trase\w*|posterior\w*|arriere|ruck\w*|hinte\w*|detras)\b/;
/** Laptop and tablet cameras the OS calls "built in": they face whoever is at the screen. */
const BUILT_IN =
  /\b(?:integrated|internal|built in|builtin|integrada|integree|integriert|integrata?|interna|interne)\b/;
/** Webcams, capture cards, virtual cameras and phones used as webcams. */
const EXTERNAL =
  /\b(?:usb|uvc|web ?cam|logitech|brio|c9\d\d|c270|razer|kiyo|elgato|cam ?link|facecam|obs|virtual|ndi|capture|hdmi|blackmagic|decklink|avermedia|magewell|epiphan|lifecam|insta360|obsbot|gopro|osmo|dslr|mirrorless|canon|nikon|sony|panasonic|lumix|fujifilm|droidcam|epoccam|ivcam|iriun|camo|continuity|desk view|iphone|ipad|document camera|visualizer)\b/;

const TRIPLE = /\b(?:triple|tripla|triplo|dreifach\w*)\b/;
const DUAL = /\b(?:dual|doble|dupla|duplo|double|doppel\w*|doppia)\b/;
const ULTRA_WIDE = /ultra ?(?:wide|gran(?:d|de)? ?ang\w*|ang\w*|weitwinkel\w*|grandangol\w*)|\b0\.5 ?x\b/;
const TELEPHOTO = /\btele(?:photo|foto|ob[ji]\w*|kamera)\b|\btele\b/;
const WIDE = /\bwide\b|\bgran(?:d|de)? ?ang\w*|\bangular\b|\bweitwinkel\w*|\bgrandangol\w*/;

/** Words that name "a camera" without saying which one. */
const GENERIC = /\b(?:camera|camara|cam|fotocamera|kamera|video|hd)\b/g;

function facingFromHint(hint: string | readonly string[] | null | undefined): LensFacing | null {
  const first = typeof hint === 'string' ? hint : hint?.[0];
  if (first === 'user') return 'front';
  if (first === 'environment') return 'back';
  if (first === 'left' || first === 'right') return 'external';
  return null;
}

/** Whichever of front/back the label names first (a label naming both is not one we've seen). */
function facingFromLabel(folded: string): 'front' | 'back' | null {
  const front = folded.search(FRONT_WORD);
  const back = folded.search(BACK_WORD);
  if (front < 0 && back < 0) return null;
  if (back < 0) return 'front';
  if (front < 0) return 'back';
  return front < back ? 'front' : 'back';
}

/**
 * Which way a camera faces and which lens it is, from its label and, where a track reports one,
 * its `facingMode` (`user`, `environment`, or the `capabilities.facingMode` array).
 *
 * Order of evidence for facing: a direction word in the label, then a built-in laptop camera
 * (faces the user), then a webcam / capture card / phone-as-webcam keyword (external, whatever the
 * driver claims), then the track's facing mode, else unknown. Labels that name no lens at all
 * (Android's "camera2 2, facing back") keep the lens kind `unknown`. A bare "Back Camera" is the
 * main lens on iOS, so it is `wide`.
 */
export function classifyLens(label: string, facingHint?: string | readonly string[] | null): LensClass {
  const folded = fold(label);
  const fromLabel = facingFromLabel(folded);
  const facing: LensFacing =
    fromLabel ??
    (BUILT_IN.test(folded) ? 'front' : null) ??
    (EXTERNAL.test(folded) ? 'external' : null) ??
    facingFromHint(facingHint) ??
    'unknown';

  let kind: LensKind = 'unknown';
  if (TRIPLE.test(folded)) kind = 'triple';
  else if (DUAL.test(folded)) kind = 'dual';
  else if (ULTRA_WIDE.test(folded)) kind = 'ultra-wide';
  else if (TELEPHOTO.test(folded)) kind = 'telephoto';
  else if (WIDE.test(folded)) kind = 'wide';
  else if (fromLabel === 'back') {
    const residue = folded.replace(BACK_WORD, ' ').replace(GENERIC, ' ').trim();
    if (residue === '') kind = 'wide';
  }
  return { facing, kind };
}

export interface GroupedLens extends Lens {
  /** 1-based among lenses of the same facing and kind, only when there is more than one. */
  ordinal: number | null;
}

export interface LensGroup {
  facing: LensFacing;
  lenses: GroupedLens[];
}

const FACING_ORDER: LensFacing[] = ['back', 'front', 'external', 'unknown'];
const KIND_ORDER: LensKind[] = ['wide', 'ultra-wide', 'telephoto', 'dual', 'triple', 'unknown'];

/**
 * Lenses grouped by facing (back, front, external, other), each group from the main lens outwards.
 * Lenses that can't be told apart by kind get an ordinal so they can still be named ("Back camera 2").
 */
export function groupLenses(lenses: readonly Lens[]): LensGroup[] {
  const groups: LensGroup[] = [];
  for (const facing of FACING_ORDER) {
    const inGroup = lenses
      .filter((l) => l.facing === facing)
      .map((l, i) => ({ l, i }))
      .sort((a, b) => KIND_ORDER.indexOf(a.l.kind) - KIND_ORDER.indexOf(b.l.kind) || a.i - b.i)
      .map(({ l }) => l);
    if (inGroup.length === 0) continue;
    const seen = new Map<LensKind, number>();
    const total = (kind: LensKind) => inGroup.filter((l) => l.kind === kind).length;
    groups.push({
      facing,
      lenses: inGroup.map((l) => {
        const n = (seen.get(l.kind) ?? 0) + 1;
        seen.set(l.kind, n);
        return { ...l, ordinal: total(l.kind) > 1 ? n : null };
      }),
    });
  }
  return groups;
}

/**
 * The cameras the browser lists. Labels (and so every classification) are empty until the page has
 * had camera permission, so call again after the first successful open. `active` carries the open
 * camera's facing mode, which only a live track can report.
 */
export async function listLenses(active?: { deviceId: string | null; facingMode?: string | null }): Promise<Lens[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  let devices: MediaDeviceInfo[];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return [];
  }
  return (
    devices
      .filter((d) => d.kind === 'videoinput')
      // Before permission some browsers list inputs with no id: nothing to choose.
      .filter((d) => d.deviceId !== '')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label,
        position: i + 1,
        ...classifyLens(d.label, active && active.deviceId === d.deviceId ? active.facingMode : null),
      }))
  );
}

export interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The zoom the track offers (Chrome on Android, recent iOS), or null where it has none. */
export function zoomRange(track: ConstrainableTrack): ZoomRange | null {
  const z = capabilitiesOf(track).zoom;
  if (!z || typeof z !== 'object') return null;
  const { min, max, step } = z;
  if (!finite(min) || !finite(max) || min <= 0 || max <= min) return null;
  return { min, max, step: finite(step) && step > 0 ? step : Math.max((max - min) / 100, 0.01) };
}

/** A zoom the track will take: inside the range and on a step (the top of the range is always reachable). */
export function clampZoom(range: ZoomRange, value: number): number {
  const inside = Math.min(range.max, Math.max(range.min, value));
  const snapped = Math.min(range.max, range.min + Math.round((inside - range.min) / range.step) * range.step);
  const nearest = Math.abs(inside - range.max) < Math.abs(inside - snapped) ? range.max : snapped;
  return Math.round(nearest * 1000) / 1000;
}

/**
 * Zoom the track to `value` (clamped to what it offers). Resolves to the zoom now in effect, or
 * null where the track has no zoom or refused it; never throws.
 */
export async function setZoom(track: ConstrainableTrack, value: number): Promise<number | null> {
  const range = zoomRange(track);
  if (!range) return null;
  const target = clampZoom(range, value);
  try {
    await applyAdvanced(track, { zoom: target });
  } catch {
    return null;
  }
  const now = settingsOf(track).zoom;
  return finite(now) ? Math.round(now * 1000) / 1000 : target;
}

/**
 * Runs `run` for one value at a time. Calls that arrive while one is running collapse into the
 * newest, and every collapsed caller gets the newest call's result: a dragged slider can't leave a
 * stale zoom behind when the camera finishes its changes out of order.
 */
export function latestWins<T, R>(run: (value: T) => Promise<R>): (value: T) => Promise<R> {
  type Waiter = { resolve: (r: R) => void; reject: (e: unknown) => void };
  let latest: T;
  let dirty = false;
  let waiters: Waiter[] = [];
  let draining = false;
  return (value) =>
    new Promise<R>((resolve, reject) => {
      latest = value;
      dirty = true;
      waiters.push({ resolve, reject });
      if (draining) return;
      draining = true;
      void (async () => {
        while (dirty) {
          const next = latest;
          const batch = waiters;
          dirty = false;
          waiters = [];
          try {
            const result = await run(next);
            for (const w of batch) w.resolve(result);
          } catch (err) {
            for (const w of batch) w.reject(err);
          }
        }
        draining = false;
      })();
    });
}
