/**
 * Web NFC (DL-10): writing the event gallery's link to a tag or wristband from the operator's phone. Only Chrome on
 * Android has it, on secure pages; everywhere else the studio explains how to do it with any NFC-writing app.
 *
 * TypeScript's DOM library has no Web NFC types, so the little of it used here is declared locally.
 */

interface NdefRecordInit {
  recordType: string;
  data?: string;
}

interface NdefWriteOptions {
  overwrite?: boolean;
  signal?: AbortSignal;
}

interface NdefReaderLike {
  write(message: { records: NdefRecordInit[] }, options?: NdefWriteOptions): Promise<void>;
}

type NdefReaderConstructor = new () => NdefReaderLike;

/** What the browser is, as far as writing tags goes: `window`, or a stand-in for it in a test. */
export interface NfcScope {
  NDEFReader?: unknown;
  isSecureContext?: boolean;
}

export type NfcSupport = 'supported' | 'insecure' | 'unsupported';

/** Can this page write tags? `insecure`: the browser has Web NFC but the page is not https. */
export function nfcSupport(scope: NfcScope): NfcSupport {
  if (typeof scope.NDEFReader !== 'function') return 'unsupported';
  return scope.isSecureContext === false ? 'insecure' : 'supported';
}

/** Why a write did not happen, in terms the operator can act on. */
export type NfcFailure = 'denied' | 'unavailable' | 'unreadable' | 'lost' | 'cancelled' | 'failed';

export class NfcError extends Error {
  constructor(readonly failure: NfcFailure) {
    super(failure);
    this.name = 'NfcError';
  }
}

/**
 * Map what `NDEFReader.write` rejects with: NotAllowedError (permission refused), NotSupportedError (no NFC
 * hardware, or NFC switched off), NotReadableError (the tag cannot be written: locked, or not for NDEF),
 * NetworkError (the tag moved away mid-write), AbortError (the operator cancelled).
 */
export function nfcFailure(err: unknown): NfcFailure {
  if (err instanceof NfcError) return err.failure;
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotSupportedError':
      return 'unavailable';
    case 'NotReadableError':
      return 'unreadable';
    case 'NetworkError':
      return 'lost';
    case 'AbortError':
      return 'cancelled';
    default:
      return 'failed';
  }
}

/**
 * Write `url` to the next tag held to the phone, as a single URL record (any phone that taps it opens the
 * link). Resolves once the tag has been written; rejects with an `NfcError`. Call it from a tap: the browser
 * only lets a page start writing from a user gesture.
 */
export async function writeUrlToTag(scope: NfcScope, url: string, signal?: AbortSignal): Promise<void> {
  if (nfcSupport(scope) !== 'supported') throw new NfcError('unavailable');
  const Reader = scope.NDEFReader as NdefReaderConstructor;
  try {
    // overwrite: a tag that already holds something (a test link, last event's) is replaced, not appended to.
    await new Reader().write({ records: [{ recordType: 'url', data: url }] }, { overwrite: true, signal });
  } catch (err) {
    throw new NfcError(nfcFailure(err));
  }
}
