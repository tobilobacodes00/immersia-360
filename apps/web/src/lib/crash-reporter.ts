import { crashFingerprint, isIgnorableError, type CrashFingerprint } from '@immersia/shared';

export interface CrashReport extends CrashFingerprint {
  kind: 'error' | 'unhandledrejection';
}

/** A runaway loop must not become a flood: at most this many distinct crashes per page load. */
const MAX_REPORTS = 5;

/**
 * Reports what takes a booth down: an uncaught error or an unhandled promise rejection. A report is
 * the error's class name and a hash of where it happened (see crashFingerprint); the message, the
 * stack and the URL never leave the device. The same crash is reported once. Returns the function
 * that removes the listeners.
 */
export function installCrashReporter(report: (crash: CrashReport) => void): () => void {
  const seen = new Set<string>();
  const send = (kind: CrashReport['kind'], fingerprint: CrashFingerprint) => {
    const key = `${fingerprint.error_name}:${fingerprint.location}`;
    if (seen.has(key) || seen.size >= MAX_REPORTS) return;
    seen.add(key);
    try {
      report({ ...fingerprint, kind });
    } catch {
      // Reporting must never be the second crash.
    }
  };

  const onError = (e: ErrorEvent) => {
    if (isIgnorableError(e.message, e.filename)) return;
    const error: unknown = e.error;
    send(
      'error',
      crashFingerprint({
        name: error instanceof Error ? error.name : null,
        filename: e.filename,
        line: e.lineno,
        col: e.colno,
        stack: error instanceof Error ? error.stack : null,
      }),
    );
  };

  const onRejection = (e: PromiseRejectionEvent) => {
    const reason: unknown = e.reason;
    send(
      'unhandledrejection',
      crashFingerprint({
        name: reason instanceof Error ? reason.name : 'UnhandledRejection',
        stack: reason instanceof Error ? reason.stack : null,
      }),
    );
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
