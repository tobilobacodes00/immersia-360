import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { gainEnvelope, type MusicSettings } from '@immersia/render-engine/audio';
import { gainAt } from './peaks';

/** Nodes are queued this far ahead of the context clock so a start is never "in the past". */
const LEAD_S = 0.05;
/** Short ramp to silence on stop, so cutting the music doesn't click. */
const STOP_RAMP_S = 0.03;
/** Wait for a slider drag to settle before re-scheduling the audible mix. */
const REPLAY_DEBOUNCE_MS = 120;
/** Playhead refresh interval under prefers-reduced-motion: it steps instead of gliding. */
const REDUCED_MOTION_FRAME_MS = 250;

interface PreviewHooks {
  /** Playhead position as a fraction (0–1) of the video's length. */
  onFrame: (fraction: number) => void;
  onEnd: () => void;
}

/**
 * Realtime playback of the soundtrack over the video's timeline, scheduled exactly like
 * `mixSoundtrack` (same `gainEnvelope`, same source start/offset/duration) but through a live
 * AudioContext. Imperative on purpose: it owns audio nodes, timers and a rAF loop, none of which
 * belong in React state.
 */
export class MixPreview {
  private readonly ctx = new AudioContext();
  private readonly buffer: AudioBuffer;
  private readonly hooks: PreviewHooks;
  private readonly frameIntervalMs: number;
  /** Context time at which the video's t = 0 falls. */
  private t0 = 0;
  private outputS = 1;
  private voice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private raf = 0;
  private lastFrame = -Infinity;
  private endTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(buffer: AudioBuffer, hooks: PreviewHooks, frameIntervalMs: number) {
    this.buffer = buffer;
    this.hooks = hooks;
    this.frameIntervalMs = frameIntervalMs;
  }

  /** Start from the beginning of the video. */
  start(music: MusicSettings, outputS: number): void {
    const startAt = this.ctx.currentTime + LEAD_S;
    this.schedule(music, outputS, startAt, 0);
  }

  /** Apply changed settings from the current playhead position without restarting the video. */
  replay(music: MusicSettings, outputS: number): void {
    const startAt = this.ctx.currentTime + LEAD_S;
    const fromS = startAt - this.t0;
    if (fromS >= outputS) return; // the end timer is about to stop us
    this.schedule(music, outputS, startAt, Math.max(0, fromS));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.endTimer);
    const { ctx, voice } = this;
    if (voice) {
      const now = ctx.currentTime;
      const param = voice.gain.gain;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(0, now + STOP_RAMP_S);
    }
    // Give the ramp time to play out before the context (and with it the nodes) goes away.
    setTimeout(() => void ctx.close().catch(() => {}), (STOP_RAMP_S + 0.05) * 1000);
  }

  private schedule(music: MusicSettings, outputS: number, startAt: number, fromS: number): void {
    if (this.disposed) return;
    const { ctx } = this;
    void ctx.resume().catch(() => {});
    this.outputS = outputS;
    this.t0 = startAt - fromS;
    // The previous voice stops exactly where its replacement begins, so a live edit is gapless.
    this.retire(startAt);

    const env = gainEnvelope(music, this.buffer.duration, outputS);
    const first = env[0];
    const last = env.at(-1);
    if (first && last && fromS < last[0]) {
      const from = Math.max(fromS, first[0]);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(gainAt(env, from), this.t0 + from);
      for (const [t, g] of env) if (t > from) gain.gain.linearRampToValueAtTime(g, this.t0 + t);
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(gain).connect(ctx.destination);
      // Same arguments as mixSoundtrack: when, where in the song, how much of it.
      src.start(this.t0 + from, music.trimStartMs / 1000 + (from - first[0]), last[0] - from);
      this.voice = { src, gain };
    }

    clearTimeout(this.endTimer);
    const untilEndMs = Math.max(0, (this.t0 + outputS - ctx.currentTime) * 1000);
    this.endTimer = setTimeout(() => this.hooks.onEnd(), untilEndMs + 60);
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private retire(at: number): void {
    const voice = this.voice;
    if (!voice) return;
    this.voice = null;
    voice.src.stop(at);
    voice.src.onended = () => {
      voice.src.disconnect();
      voice.gain.disconnect();
    };
  }

  private positionS(): number {
    return Math.min(this.outputS, Math.max(0, this.ctx.currentTime - this.t0));
  }

  private frame = (now: number): void => {
    this.raf = 0;
    if (this.disposed) return;
    if (now - this.lastFrame >= this.frameIntervalMs) {
      this.lastFrame = now;
      this.hooks.onFrame(this.positionS() / this.outputS);
    }
    this.raf = requestAnimationFrame(this.frame);
  };
}

/**
 * Play/stop for the editor. The AudioContext is created inside the click (autoplay policy), and
 * playback ends on its own at the end of the video, when the song changes, when the editor is
 * disabled, and on unmount. Edits made while it plays are applied live from the current position.
 */
export function useMixPreview(opts: {
  buffer: AudioBuffer | null;
  music: MusicSettings;
  outputSeconds: number;
  disabled: boolean;
  /** Element whose `left` follows the playhead; written directly so playback never re-renders React. */
  playheadRef: RefObject<HTMLElement | null>;
}): { playing: boolean; toggle: () => void } {
  const { buffer, music, outputSeconds, disabled, playheadRef } = opts;
  const session = useRef<MixPreview | null>(null);
  const [playing, setPlaying] = useState(false);

  const stop = useCallback(() => {
    session.current?.dispose();
    session.current = null;
    setPlaying(false);
  }, []);

  const toggle = () => {
    if (session.current) {
      stop();
      return;
    }
    if (!buffer || disabled) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const preview = new MixPreview(
      buffer,
      {
        onFrame: (fraction) => {
          const el = playheadRef.current;
          if (el) el.style.left = `${fraction * 100}%`;
        },
        onEnd: stop,
      },
      reduced ? REDUCED_MOTION_FRAME_MS : 0,
    );
    session.current = preview;
    preview.start(music, outputSeconds);
    setPlaying(true);
  };

  // A different song, or an editor that just became read-only, ends playback; so does unmounting.
  useEffect(() => {
    if (!buffer || disabled) return;
    return stop;
  }, [buffer, disabled, stop]);

  const { trimStartMs, trimEndMs, offsetMs, fadeInMs, fadeOutMs, volume } = music;
  useEffect(() => {
    const preview = session.current;
    if (!preview) return;
    const id = setTimeout(
      () => preview.replay({ trimStartMs, trimEndMs, offsetMs, fadeInMs, fadeOutMs, volume }, outputSeconds),
      REPLAY_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [trimStartMs, trimEndMs, offsetMs, fadeInMs, fadeOutMs, volume, outputSeconds]);

  return { playing, toggle };
}
