import type { EventFrom, RenderPath, Video360Settings } from '@immersia/shared';

/**
 * The analytics events of a render (catalogue: `render_completed`, `render_failed`), built the one way for
 * every rung of the render ladder. A booth sends them through its own outbox like every other device event,
 * so a booth with no signal still reports; `path` says which rung did the work.
 */

type RenderCompleted = Extract<EventFrom<'device'>, { name: 'render_completed' }>;
type RenderFailed = Extract<EventFrom<'device'>, { name: 'render_failed' }>;

const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));

/**
 * A finished render. `renderMs` is the rendering itself (on a device: with the time spent paused taken out;
 * on the server: the worker's own time). `seconds_since_take` is the capture-to-QR figure: how long after the
 * take ended its files were ready, queue wait included (not meaningful for an imported file).
 */
export function renderCompleted(input: {
  take: { trigger: string; capturedAt: number; durationMs: number };
  video: Pick<Video360Settings, 'resolution' | 'fps' | 'quality' | 'effects'>;
  path: RenderPath;
  renderMs: number;
  now: number;
}): RenderCompleted {
  const { take, video } = input;
  return {
    name: 'render_completed',
    render_ms: clamp(input.renderMs, 3_600_000),
    path: input.path,
    preset: `${video.resolution}-${video.fps}fps-${video.quality}`,
    effects_count: clamp(video.effects.length, 32),
    mode: 'video360',
    ...(take.trigger === 'import'
      ? {}
      : { seconds_since_take: clamp((input.now - (take.capturedAt + take.durationMs)) / 1000, 86_400) }),
  };
}

/** A failed render, or a take the ladder gave up on. A cancel is the operator's choice, so it is not reported. */
export function renderFailed(input: { code: string; path: RenderPath; browser: string }): RenderFailed | null {
  if (input.code === 'cancelled') return null;
  return { name: 'render_failed', error_code: input.code.slice(0, 60), path: input.path, browser: input.browser };
}
