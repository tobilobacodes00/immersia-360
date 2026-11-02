/**
 * Crash reports from the booth (the crash-free-events success metric). A report says what kind of
 * error it was and where, and nothing else: the error's class name, and a hash of the code location.
 * Never the message (which can quote a file name or a guest's input), never the stack, never a URL
 * with its query string. Pure functions, so the rules are testable without a browser.
 */

/** FNV-1a, 32 bit, as 8 hex characters: small, synchronous (safe inside an error handler), stable. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** `https://app/_next/static/chunks/a1b2.js?v=3#x` → `/_next/static/chunks/a1b2.js`: the file, not the visitor's URL. */
export function scriptPath(filename: string | null | undefined): string {
  if (!filename) return '';
  const noQuery = filename.split(/[?#]/)[0] ?? '';
  const path = noQuery.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  return path.slice(0, 200);
}

/** The first `file:line:col` in a stack trace, for errors that arrive without a location (rejections). */
export function firstStackFrame(
  stack: string | null | undefined,
): { filename: string; line: number; col: number } | null {
  if (!stack) return null;
  const m = /((?:https?|file|blob|chrome-extension|webpack-internal):\/\/[^\s)]+?|\/[^\s):]+):(\d+):(\d+)/.exec(stack);
  return m ? { filename: m[1] ?? '', line: Number(m[2]), col: Number(m[3]) } : null;
}

export interface CrashInput {
  /** `error.name`, when the thrown value is an Error. */
  name?: string | null;
  filename?: string | null;
  line?: number | null;
  col?: number | null;
  stack?: string | null;
}

export interface CrashFingerprint {
  error_name: string;
  location: string;
}

const SAFE_NAME = /^[A-Za-z0-9_$.]{1,40}$/;

/**
 * The two fields a `booth_crashed` event carries. An error name that is not a plain identifier
 * (someone threw a string, or a library sets a sentence as the name) is reported as `Error`.
 */
export function crashFingerprint(input: CrashInput): CrashFingerprint {
  const name = input.name?.trim();
  const frame =
    input.filename || input.line
      ? { filename: input.filename ?? '', line: input.line ?? 0, col: input.col ?? 0 }
      : firstStackFrame(input.stack);
  const where = frame ? `${scriptPath(frame.filename)}:${frame.line}:${frame.col}` : 'unknown';
  return { error_name: name && SAFE_NAME.test(name) ? name : 'Error', location: fnv1a(where) };
}

/**
 * Noise that is not the booth crashing: Chrome's harmless layout notification, and the opaque
 * "Script error." a cross-origin script produces when the page can't see inside it.
 */
export function isIgnorableError(message: string | null | undefined, filename: string | null | undefined): boolean {
  if (message && /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/.test(message))
    return true;
  return message === 'Script error.' && !filename;
}
