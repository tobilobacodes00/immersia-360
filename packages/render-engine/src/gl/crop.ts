import type { Rotation } from 'mediabunny';

/**
 * Cover-crop parameters mapping output uv → display uv of a source: the source is scaled to cover the
 * output (no bars), centred, and cropped; `rotation` is the container's, applied before the crop.
 */
export function coverCrop(srcW: number, srcH: number, rotation: Rotation, outW: number, outH: number) {
  const [dw, dh] = rotation === 90 || rotation === 270 ? [srcH, srcW] : [srcW, srcH];
  const scale = Math.max(outW / dw, outH / dh);
  const sx = outW / (dw * scale);
  const sy = outH / (dh * scale);
  return { scale: [sx, sy] as [number, number], offset: [(1 - sx) / 2, (1 - sy) / 2] as [number, number] };
}
