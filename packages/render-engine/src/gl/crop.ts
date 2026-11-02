import type { Rotation } from 'mediabunny';

export interface Crop {
  scale: [number, number];
  offset: [number, number];
}

/**
 * Cover-crop parameters mapping output uv → display uv of a source: the source is scaled to cover the
 * output (no bars), centred, and cropped; `rotation` is the container's, applied before the crop.
 */
export function coverCrop(srcW: number, srcH: number, rotation: Rotation, outW: number, outH: number): Crop {
  const [dw, dh] = rotation === 90 || rotation === 270 ? [srcH, srcW] : [srcW, srcH];
  const scale = Math.max(outW / dw, outH / dh);
  const sx = outW / (dw * scale);
  const sy = outH / (dh * scale);
  return { scale: [sx, sy], offset: [(1 - sx) / 2, (1 - sy) / 2] };
}

/**
 * A cover crop looked at more closely, for a slow push-in or pan (the highlight reel's photo strips):
 * `zoom` ≥ 1 narrows the window, and `panX`/`panY` (−1 … 1, 0 = centred, y down) move it through all the
 * room the source leaves around it, so ±1 puts the window against that edge of the picture.
 */
export function zoomedCrop(crop: Crop, zoom: number, panX: number, panY: number): Crop {
  const z = Math.max(1, zoom);
  const sx = crop.scale[0] / z;
  const sy = crop.scale[1] / z;
  const at = (pan: number) => 0.5 + 0.5 * Math.max(-1, Math.min(1, pan));
  return { scale: [sx, sy], offset: [(1 - sx) * at(panX), (1 - sy) * at(panY)] };
}
