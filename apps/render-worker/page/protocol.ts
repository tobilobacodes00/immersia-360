import type { ServerRenderError } from '@immersia/shared/render';

/**
 * What the worker (Node) and the render page (Chrome) say to each other. Types only: both sides
 * import this file, neither imports the other.
 */

/** The names of a recipe's media in the spec (the page asks the worker's file server for each). */
export interface JobFileUrls {
  original?: string;
  overlay?: string;
  endCard?: string;
  intro?: string;
  outro?: string;
  music?: string;
  background?: string;
}

export interface RunSpec {
  /** The recipe, as the server sent it (validated again by the page: it is a trust boundary too). */
  recipe: unknown;
  /** Directory of the segmenter's model and runtime, e.g. `http://127.0.0.1:41234/t0k3n/page/mediapipe`. */
  mediapipeBase: string;
  /** URLs of the job's files; a file the job does not have is absent. */
  files: JobFileUrls;
  /** Where each result is PUT. */
  put: { mp4: string; poster: string; small: string };
}

export interface RunOutput {
  kind: 'mp4' | 'small_mp4' | 'poster';
  bytes: number;
  width: number;
  height: number;
  durationMs: number;
}

export type RunResult =
  | {
      ok: true;
      outputs: RunOutput[];
      renderMs: number;
      frames: number;
      encoder: 'native' | 'wasm';
      background: 'none' | 'applied' | 'unavailable';
    }
  | { ok: false; code: ServerRenderError; message: string };

/** One line of the CI smoke test's report. */
export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

declare global {
  interface Window {
    /** Defined by the render page (entry.ts). */
    __run(spec: RunSpec): Promise<RunResult>;
    /** Exposed by the worker before the page loads: render progress, 0..1. */
    __progress?(p: number): void;
    /** Defined by the smoke page (smoke-entry.ts), never by the production bundle. */
    __smoke?(mediapipeBase: string): Promise<SmokeCheck[]>;
    __fixtureClip?(): Promise<string>;
  }
}
