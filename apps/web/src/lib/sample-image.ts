import type { PersonMask } from '@immersia/render-engine/background';

/** An OffscreenCanvas, or a canvas element where there is none (Safari before 16.4). */
function drawingSurface(width: number, height: number) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, g: canvas.getContext('2d')! };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, g: canvas.getContext('2d')! };
}

/**
 * A stand-in event photo for look and effect previews (screen 5): sky, warm and cool light, two
 * people with different skin tones, saturated props. Drawn, not shipped, so it costs no download
 * and carries no one's likeness; every look's character (warmth, contrast, toning, saturation)
 * shows on it.
 */
export function sampleScene(width = 320, height = 400): OffscreenCanvas | HTMLCanvasElement {
  const { canvas: c, g } = drawingSurface(width, height);
  const u = Math.min(width, height);

  const sky = g.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#5b8fd6');
  sky.addColorStop(0.55, '#f2c6a0');
  sky.addColorStop(1, '#3a2f3d');
  g.fillStyle = sky;
  g.fillRect(0, 0, width, height);

  // Warm key light from the top right.
  const sun = g.createRadialGradient(width * 0.8, height * 0.2, 0, width * 0.8, height * 0.2, u * 0.45);
  sun.addColorStop(0, 'rgba(255,236,190,0.95)');
  sun.addColorStop(1, 'rgba(255,236,190,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, width, height);

  // Balloons: saturated primaries for saturation and hue shifts.
  const balloon = (x: number, y: number, r: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x, y, r, r * 1.2, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = u * 0.006;
    g.beginPath();
    g.moveTo(x, y + r * 1.2);
    g.lineTo(x + r * 0.2, y + r * 3);
    g.stroke();
  };
  balloon(width * 0.15, height * 0.22, u * 0.07, '#e5243b');
  balloon(width * 0.3, height * 0.14, u * 0.06, '#f7c600');
  balloon(width * 0.88, height * 0.45, u * 0.065, '#1fa37a');

  // Two people: a deeper and a lighter skin tone, dark and light clothes (shadows and highlights).
  const person = (x: number, skin: string, cloth: string, hair: string) => {
    const head = u * 0.11;
    const top = height * 0.5;
    g.fillStyle = cloth;
    g.beginPath();
    g.roundRect(x - head * 1.5, top + head * 1.3, head * 3, height - top, head);
    g.fill();
    g.fillStyle = skin;
    g.beginPath();
    g.arc(x, top + head * 0.3, head, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = hair;
    g.beginPath();
    g.arc(x, top + head * 0.05, head * 1.02, Math.PI, Math.PI * 2);
    g.fill();
  };
  person(width * 0.36, '#8d5a3b', '#1c1d2b', '#1a1210');
  person(width * 0.66, '#e9b99a', '#f4efe6', '#6b3f22');

  // Floor bounce and fine detail (grain, sharpening and halftone have something to bite on).
  g.fillStyle = 'rgba(30,20,30,0.45)';
  g.fillRect(0, height * 0.9, width, height * 0.1);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 40; i++) {
    const x = ((i * 97) % 100) / 100;
    const y = ((i * 53) % 100) / 100;
    g.fillRect(x * width, y * height * 0.45, u * 0.006, u * 0.006);
  }
  return c;
}

/**
 * The silhouette of the two people in `sampleScene`, as a person mask (1 inside, 0 outside, soft edges) on a grid
 * `cell` times coarser than the picture. A real segmenter's mask is not available for a drawn scene, so the
 * studio previews background replacement with this one: it shows how the background sits behind two people and
 * how the edges look, not how well the model will follow a real guest.
 */
export function sampleMask(width = 320, height = 400, cell = 4): PersonMask {
  const w = Math.max(1, Math.round(width / cell));
  const h = Math.max(1, Math.round(height / cell));
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.scale(w / width, h / height);
  g.fillStyle = '#000';
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#fff';
  const u = Math.min(width, height);
  // The same shapes as `person` in sampleScene: a rounded torso and a round head.
  for (const x of [width * 0.36, width * 0.66]) {
    const head = u * 0.11;
    const top = height * 0.5;
    g.beginPath();
    g.roundRect(x - head * 1.5, top + head * 1.3, head * 3, height - top, head);
    g.fill();
    g.beginPath();
    g.arc(x, top + head * 0.3, head * 1.02, 0, Math.PI * 2);
    g.fill();
  }
  const pixels = g.getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = pixels[i * 4]! / 255;
  return { data, width: w, height: h };
}
