import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_VERY_HIGH,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  type InputVideoTrack,
} from 'mediabunny';
import type { TakeProbe } from './probe';
import { frameRuns, type FrameRun, type VideoFrameRef } from './timeline';

/** What the compositor receives for one output frame. */
export interface FramePair {
  /** Output frame number. */
  index: number;
  a: VideoSample;
  b: VideoSample | null;
  alpha: number;
}

/** Container time to request for frame i: midway to the next frame, robust to rounding. */
function requestTime(pts: Float64Array, first: number, i: number): number {
  const next = i + 1 < pts.length ? pts[i + 1]! : pts[i]! + 0.02;
  return first + (pts[i]! + next) / 2;
}

/**
 * Serves decoded frames in timeline order.
 *
 * Forward runs stream from the take with `samplesAtTimestamps` (sorted, so each packet is decoded at
 * most once). Backward runs (reverse, boomerang) would need random access, which is expensive when
 * keyframes are sparse — MediaRecorder output often has one keyframe per many seconds. So the frames
 * those runs revisit are re-encoded once into an all-keyframe cache in memory; each cached frame
 * decodes on its own, and memory stays proportional to the reversed span, not the whole clip.
 *
 * Contract: a yielded pair's samples stay open until the consumer asks for the next pair; the
 * source closes them afterwards. Consumers must finish using a pair (e.g. upload it to a texture)
 * before advancing.
 */
export class FrameSource {
  private cache: { input: Input<BlobSource>; sink: VideoSampleSink; offset: number; pts: Float64Array } | null = null;

  constructor(private readonly probe: TakeProbe) {}

  async *pairs(refs: VideoFrameRef[], signal?: AbortSignal): AsyncGenerator<FramePair> {
    const runs = frameRuns(refs);
    const backward = runs.filter((r) => r.direction === 'backward');
    if (backward.length) await this.buildCache(refs, backward, signal);
    for (const run of runs) {
      if (signal?.aborted) return;
      yield* run.direction === 'forward' ? this.forward(refs, run, signal) : this.backward(refs, run, signal);
    }
  }

  dispose() {
    this.cache?.input.dispose();
    this.cache = null;
  }

  private async *forward(refs: VideoFrameRef[], run: FrameRun, signal?: AbortSignal): AsyncGenerator<FramePair> {
    const { pts, firstTimestamp, video } = this.probe;
    yield* this.serve(refs, run, new VideoSampleSink(video), (i) => requestTime(pts, firstTimestamp, i), 'asc', signal);
  }

  private async *backward(refs: VideoFrameRef[], run: FrameRun, signal?: AbortSignal): AsyncGenerator<FramePair> {
    const cache = this.cache!;
    yield* this.serve(refs, run, cache.sink, (i) => requestTime(cache.pts, 0, i - cache.offset), 'desc', signal);
  }

  /**
   * Decode the indices a run needs (once each, in the run's order) and hand out pairs, closing
   * samples as soon as no later frame in the run can use them.
   */
  private async *serve(
    refs: VideoFrameRef[],
    run: FrameRun,
    sink: VideoSampleSink,
    timeOf: (i: number) => number,
    order: 'asc' | 'desc',
    signal?: AbortSignal,
  ): AsyncGenerator<FramePair> {
    const slice = refs.slice(run.start, run.end);
    const needed = [...new Set(slice.flatMap((r) => (r.b === null ? [r.a] : [r.a, r.b])))].sort((x, y) =>
      order === 'asc' ? x - y : y - x,
    );
    const live = new Map<number, VideoSample>();
    const decoded = sink.samplesAtTimestamps(needed.map(timeOf));
    let cursor = 0;
    const ensure = async (i: number) => {
      while (!live.has(i)) {
        if (cursor >= needed.length) throw new Error(`frame ${i} was not decoded`);
        const next = await decoded.next();
        if (next.done) throw new Error(`decoder ended before frame ${i}`);
        const idx = needed[cursor++]!;
        if (next.value) live.set(idx, next.value);
        else if (cursor > 1)
          live.set(idx, live.get(needed[cursor - 2]!)!.clone()); // gap: repeat neighbour
        else throw new Error(`frame ${idx} unavailable`);
      }
      return live.get(i)!;
    };
    try {
      for (let k = 0; k < slice.length; k++) {
        if (signal?.aborted) return;
        const r = slice[k]!;
        const a = await ensure(r.a);
        const b = r.b === null ? null : await ensure(r.b);
        yield { index: run.start + k, a, b, alpha: r.alpha };
        // Free frames no remaining output in this run can reference.
        const rest = slice.slice(k + 1, k + 3);
        const keepFrom = rest.length ? Math.min(...rest.map((x) => Math.min(x.a, x.b ?? x.a))) : Infinity;
        const keepTo = rest.length ? Math.max(...rest.map((x) => Math.max(x.a, x.b ?? x.a))) : -Infinity;
        for (const [i, s] of live) {
          const stillNeeded = order === 'asc' ? i >= keepFrom : i <= keepTo;
          if (!stillNeeded) {
            s.close();
            live.delete(i);
          }
        }
      }
    } finally {
      for (const s of live.values()) s.close();
      await decoded.return(undefined);
    }
  }

  /** Re-encode every frame the backward runs touch as keyframes, into an in-memory MP4. */
  private async buildCache(refs: VideoFrameRef[], backward: FrameRun[], signal?: AbortSignal) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const run of backward)
      for (let k = run.start; k < run.end; k++) {
        const r = refs[k]!;
        lo = Math.min(lo, r.a);
        hi = Math.max(hi, r.b ?? r.a);
      }
    const { video, pts, firstTimestamp } = this.probe;
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const source = new VideoSampleSource({ codec: 'avc', quality: QUALITY_VERY_HIGH, keyFrameInterval: 0 });
    output.addVideoTrack(source);
    await output.start();
    const sink = new VideoSampleSink(video);
    const indices = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
    const local = new Float64Array(indices.length);
    let k = 0;
    // Held in an object: a plain `let` gets narrowed to null across the for-await body.
    const last: { frame: VideoFrame | null } = { frame: null };
    try {
      for await (const sample of sink.samplesAtTimestamps(indices.map((i) => requestTime(pts, firstTimestamp, i)))) {
        if (signal?.aborted) {
          sample?.close();
          await output.cancel();
          return;
        }
        // A missing frame repeats its neighbour so cache position k always equals source index lo + k.
        const frame: VideoFrame | undefined = sample ? sample.toVideoFrame() : last.frame?.clone();
        sample?.close();
        if (!frame) throw new Error(`frame ${lo + k} could not be decoded`);
        // Re-time densely: cached frame k sits at k/30 s, whatever the source timing was.
        local[k] = k / 30;
        const retimed = new VideoSample(frame.clone(), { timestamp: k / 30, duration: 1 / 30 });
        last.frame?.close();
        last.frame = frame;
        await source.add(retimed, { keyFrame: true });
        retimed.close();
        k++;
      }
    } finally {
      last.frame?.close();
    }
    await output.finalize();
    const input = new Input({
      source: new BlobSource(new Blob([target.buffer!], { type: 'video/mp4' })),
      formats: ALL_FORMATS,
    });
    const track = (await input.getPrimaryVideoTrack()) as InputVideoTrack;
    this.cache = { input, sink: new VideoSampleSink(track), offset: lo, pts: local };
  }
}
