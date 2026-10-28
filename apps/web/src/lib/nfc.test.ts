import { describe, expect, it } from 'vitest';
import { DOWNLOAD_ROUTES, galleryUrl, parseRoute } from '@immersia/shared';
import { NfcError, nfcFailure, nfcSupport, writeUrlToTag } from './nfc';

const domError = (name: string) => new DOMException('x', name);

/** A stand-in for the browser's NDEFReader that records what it was asked to write. */
function fakeReader(outcome: 'ok' | Error = 'ok') {
  const writes: { message: unknown; options: unknown }[] = [];
  class Reader {
    async write(message: unknown, options: unknown) {
      writes.push({ message, options });
      if (outcome !== 'ok') throw outcome;
    }
  }
  return { Reader, writes };
}

describe('nfcSupport', () => {
  it('is supported where the browser has NDEFReader on a secure page', () => {
    expect(nfcSupport({ NDEFReader: class {}, isSecureContext: true })).toBe('supported');
  });

  it('is unsupported without NDEFReader: desktop Chrome, Safari, Firefox', () => {
    expect(nfcSupport({ isSecureContext: true })).toBe('unsupported');
    expect(nfcSupport({})).toBe('unsupported');
  });

  it('is told apart when the API exists but the page is not https', () => {
    expect(nfcSupport({ NDEFReader: class {}, isSecureContext: false })).toBe('insecure');
  });
});

describe('nfcFailure', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotSupportedError', 'unavailable'],
    ['NotReadableError', 'unreadable'],
    ['NetworkError', 'lost'],
    ['AbortError', 'cancelled'],
    ['SomethingElse', 'failed'],
  ])('%s is %s', (name, expected) => {
    expect(nfcFailure(domError(name))).toBe(expected);
  });

  it('copes with things that are not errors', () => {
    expect(nfcFailure('nope')).toBe('failed');
    expect(nfcFailure(null)).toBe('failed');
    expect(nfcFailure(new NfcError('lost'))).toBe('lost');
  });
});

describe('writeUrlToTag', () => {
  const url = 'https://immersia.example/g/abcdefghijklmnop?r=nfc';

  it('writes one URL record and replaces what the tag held', async () => {
    const { Reader, writes } = fakeReader();
    const controller = new AbortController();
    await writeUrlToTag({ NDEFReader: Reader, isSecureContext: true }, url, controller.signal);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.message).toEqual({ records: [{ recordType: 'url', data: url }] });
    expect(writes[0]!.options).toEqual({ overwrite: true, signal: controller.signal });
  });

  it('rejects with what went wrong, in the operator’s terms', async () => {
    for (const [name, failure] of [
      ['NotAllowedError', 'denied'],
      ['NetworkError', 'lost'],
      ['NotReadableError', 'unreadable'],
    ] as const) {
      const { Reader } = fakeReader(domError(name));
      await expect(writeUrlToTag({ NDEFReader: Reader, isSecureContext: true }, url)).rejects.toMatchObject({
        failure,
      });
    }
  });

  it('does not try on a browser without Web NFC', async () => {
    await expect(writeUrlToTag({}, url)).rejects.toMatchObject({ failure: 'unavailable' });
    await expect(writeUrlToTag({ NDEFReader: class {}, isSecureContext: false }, url)).rejects.toBeInstanceOf(NfcError);
  });
});

describe('the NFC route (DL-10, DL-13)', () => {
  it('is one of the download routes, and is what a tag’s link carries', () => {
    expect(DOWNLOAD_ROUTES).toContain('nfc');
    expect(parseRoute('nfc')).toBe('nfc');
    const link = galleryUrl('https://immersia.example', 'abcdefghijklmnop', 'nfc');
    expect(link).toBe('https://immersia.example/g/abcdefghijklmnop?r=nfc');
    expect(parseRoute(new URL(link).searchParams.get('r'))).toBe('nfc');
  });
});
