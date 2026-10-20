import type { OpenedCamera, Resolution } from './camera';
import { RESOLUTION_SIZE } from './camera';

/**
 * Simulated camera, after Immersia Booth's simulator: every flow runs with no hardware. For 360 the
 * scene must MOVE sideways like a spinning platform (so the motion trigger and slow motion have
 * something real to work on), so this draws a procedural studio: a striped backdrop panning past a
 * figure at a steady angular speed, with a frame counter so encoded output can be checked.
 * It returns a real MediaStream (canvas.captureStream), so recording works on every browser,
 * including WebKit in CI where there is no fake camera.
 */
export function openSimulatedCamera(opts: { resolution: Resolution; frameRate: number }): OpenedCamera {
  const { width, height } = RESOLUTION_SIZE[opts.resolution];
  // Draw at most 720p: the simulator has no real detail to resolve, and a cheaper draw keeps its
  // frame rate up on software-rendered machines (CI runners), which the motion trigger depends on.
  const scale = Math.min(1, 1280 / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const W = canvas.width;
  const H = canvas.height;
  const start = performance.now();
  let frame = 0;
  let running = true;
  let raf = 0;

  const draw = () => {
    if (!running) return;
    const t = (performance.now() - start) / 1000;
    // One full "revolution" every 8 s: the backdrop scrolls a full width per turn.
    const pan = ((t / 8) % 1) * W * 2;
    ctx.fillStyle = '#e9e6df';
    ctx.fillRect(0, 0, W, H);
    const stripe = W / 12;
    for (let i = -2; i < 26; i++) {
      const x = i * stripe - (pan % (stripe * 2));
      // Real contrast, like a studio backdrop: the motion trigger needs edges to see the pan.
      ctx.fillStyle = i % 2 ? '#e7e5df' : '#8f8b82';
      ctx.fillRect(x, 0, stripe, H * 0.72);
    }
    ctx.fillStyle = '#b9b5ab';
    ctx.fillRect(0, H * 0.72, W, H * 0.28);
    // A figure on the platform, swaying a little like a real guest.
    const cx = W / 2 + Math.sin(t * 1.3) * W * 0.01;
    ctx.fillStyle = '#2b3fe6';
    ctx.beginPath();
    ctx.ellipse(cx, H * 0.6, W * 0.06, H * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111110';
    ctx.beginPath();
    ctx.arc(cx, H * 0.3, H * 0.075, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111110';
    ctx.font = `600 ${Math.round(H * 0.03)}px system-ui, sans-serif`;
    ctx.fillText(`Simulated camera · ${String(frame).padStart(5, '0')}`, W * 0.03, H * 0.06);
    frame++;
    raf = requestAnimationFrame(draw);
  };
  draw();

  const stream = canvas.captureStream(opts.frameRate);
  const track = stream.getVideoTracks()[0]!;
  return {
    kind: 'simulator',
    label: 'Simulated camera',
    stream,
    track,
    settings: { width: W, height: H, frameRate: opts.frameRate, deviceId: null, facingMode: null },
    lens: { facing: 'unknown', kind: 'unknown' },
    torch: { supported: false, set: async () => ({ ok: false, reason: 'unsupported' }) },
    zoom: { range: null, set: async () => null },
    applied: { zoom: null, torch: false },
    stop: () => {
      running = false;
      cancelAnimationFrame(raf);
      track.stop();
    },
  };
}
