/**
 * A synthetic test picture for the effects: everything a shader can mishandle in one frame, and
 * deliberately asymmetric (left/right and top/bottom) so a mirror, flip or swirl cannot hide.
 *
 *   top third     eight 100% colour bars (white, yellow, cyan, green, magenta, red, blue, black)
 *   middle third  a grey ramp (left half) and a full hue ramp (right half)
 *   bottom third  a vertical blue-to-orange gradient carrying an asymmetric "F" (left), a skin-tone disc
 *                 on teal split by a diagonal (centre), an 8 px checkerboard (right)
 */
export const PATTERN_W = 256;
export const PATTERN_H = 192;

export function drawTestPattern(width = PATTERN_W, height = PATTERN_H): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available');
  const bandH = height / 3;
  const unit = height / 192;

  // Fully opaque, including the anti-aliased edges of the fractional-width panels below (a canvas
  // starts transparent, and the runner treats its sources as opaque).
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  // Top: colour bars
  const bars = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000'];
  bars.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round((i * width) / 8), 0, Math.ceil(width / 8), Math.ceil(bandH));
  });

  // Middle: grey ramp and hue ramp
  const grey = ctx.createLinearGradient(0, 0, width / 2, 0);
  grey.addColorStop(0, '#000000');
  grey.addColorStop(1, '#ffffff');
  ctx.fillStyle = grey;
  ctx.fillRect(0, bandH, width / 2, bandH);
  const hue = ctx.createLinearGradient(width / 2, 0, width, 0);
  ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].forEach((c, i, a) =>
    hue.addColorStop(i / (a.length - 1), c),
  );
  ctx.fillStyle = hue;
  ctx.fillRect(width / 2, bandH, width / 2, bandH);

  // Bottom left: vertical gradient and an "F"
  const sky = ctx.createLinearGradient(0, 2 * bandH, 0, height);
  sky.addColorStop(0, '#1d4ed8');
  sky.addColorStop(1, '#f97316');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 2 * bandH, width / 3, bandH);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(10 * unit, 2 * bandH + 8 * unit, 8 * unit, 48 * unit);
  ctx.fillRect(10 * unit, 2 * bandH + 8 * unit, 30 * unit, 8 * unit);
  ctx.fillRect(10 * unit, 2 * bandH + 28 * unit, 22 * unit, 8 * unit);

  // Bottom centre: skin-tone disc on teal, with a diagonal
  const cx0 = width / 3;
  ctx.fillStyle = '#0f766e';
  ctx.fillRect(cx0, 2 * bandH, width / 3, bandH);
  ctx.fillStyle = '#e0ac8c';
  ctx.beginPath();
  ctx.arc(cx0 + width / 6 - 6 * unit, 2 * bandH + bandH / 2, 24 * unit, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 3 * unit;
  ctx.beginPath();
  ctx.moveTo(cx0, 2 * bandH);
  ctx.lineTo(cx0 + width / 3, height);
  ctx.stroke();

  // Bottom right: checkerboard
  const cell = Math.max(2, Math.round(8 * unit));
  const x0 = Math.round((2 * width) / 3);
  for (let y = 0; y * cell < bandH; y++)
    for (let x = 0; x0 + x * cell < width; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f3f4f6' : '#1f2937';
      ctx.fillRect(x0 + x * cell, Math.round(2 * bandH) + y * cell, cell, cell);
    }
  return canvas;
}

/** RGBA bytes of any canvas (a WebGL canvas is copied through a 2D canvas first). */
export function readPixels(source: OffscreenCanvas | HTMLCanvasElement): Uint8ClampedArray {
  const copy = new OffscreenCanvas(source.width, source.height);
  const ctx = copy.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, source.width, source.height).data;
}
