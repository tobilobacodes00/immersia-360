import { describe, expect, it } from 'vitest';
import {
  ASSET_RULES,
  ASSET_TYPES,
  assetMaxBytes,
  assetUploadSchema,
  canonicalMime,
  normaliseMime,
  sniffMime,
} from '../src/asset';

/** A file head: the given bytes (numbers) or ASCII (strings), padded to 32 bytes. */
function head(...parts: (number | string)[]): Uint8Array {
  const out = new Uint8Array(32);
  let at = 0;
  for (const p of parts) {
    if (typeof p === 'number') out[at++] = p;
    else for (const ch of p) out[at++] = ch.charCodeAt(0);
  }
  return out;
}

describe('sniffMime', () => {
  const cases: [string, Uint8Array][] = [
    ['image/png', head(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a)],
    ['image/jpeg', head(0xff, 0xd8, 0xff, 0xe0)],
    ['image/webp', head('RIFF', 0, 0, 0, 0, 'WEBPVP8 ')],
    ['audio/wav', head('RIFF', 0, 0, 0, 0, 'WAVEfmt ')],
    ['video/mp4', head(0, 0, 0, 0x20, 'ftypisom')],
    ['video/mp4', head(0, 0, 0, 0x18, 'ftypmp42')],
    ['video/quicktime', head(0, 0, 0, 0x14, 'ftypqt  ')],
    ['audio/mp4', head(0, 0, 0, 0x20, 'ftypM4A ')],
    ['video/webm', head(0x1a, 0x45, 0xdf, 0xa3, 0x9f)],
    ['audio/mpeg', head('ID3', 4, 0)],
    ['audio/mpeg', head(0xff, 0xfb, 0x90, 0x00)],
    ['audio/mpeg', head(0xff, 0xe3, 0x18, 0xc4)],
    ['audio/aac', head(0xff, 0xf1, 0x50, 0x80)],
    ['audio/aac', head(0xff, 0xf9, 0x50, 0x80)],
    ['font/woff2', head('wOF2', 0, 1, 0, 0)],
    ['font/woff', head('wOFF', 0, 1, 0, 0)],
    ['font/ttf', head(0, 1, 0, 0, 0, 0x0c)],
    ['font/ttf', head('true', 0, 0x0c)],
    ['font/otf', head('OTTO', 0, 0x0c)],
  ];

  it.each(cases)('identifies %s', (mime, bytes) => {
    expect(sniffMime(bytes)).toBe(mime);
  });

  it('refuses SVG, HTML, GIF and plain text', () => {
    for (const text of [
      '<?xml version="1.0"?><svg',
      '<svg xmlns="http://www.w3.org/2000/svg"',
      '<!DOCTYPE html>',
      'GIF89a',
    ]) {
      expect(sniffMime(head(text))).toBeNull();
    }
    expect(sniffMime(head('hello world, this is not media'))).toBeNull();
  });

  it('refuses a RIFF container that is neither WebP nor WAVE', () => {
    expect(sniffMime(head('RIFF', 0, 0, 0, 0, 'AVI LIST'))).toBeNull();
  });

  it('does not take reserved MPEG frame headers for MP3, nor ADTS for MP3', () => {
    expect(sniffMime(head(0xff, 0xfb, 0xf0, 0x00))).toBeNull(); // bitrate index 15
    expect(sniffMime(head(0xff, 0xfb, 0x9c, 0x00))).toBeNull(); // sample rate index 3
    expect(sniffMime(head(0xff, 0xeb, 0x90, 0x00))).toBeNull(); // reserved MPEG version
    expect(sniffMime(head(0xff, 0xf1))).toBe('audio/aac');
  });

  it('copes with short and empty input', () => {
    expect(sniffMime(new Uint8Array(0))).toBeNull();
    expect(sniffMime(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(sniffMime(new Uint8Array([0xff]))).toBeNull();
    expect(sniffMime(new Uint8Array([0xff, 0xfb]))).toBeNull();
    expect(sniffMime(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]))).toBe('video/mp4');
  });
});

describe('normaliseMime', () => {
  it('maps the aliases browsers report', () => {
    expect(normaliseMime('audio/x-wav')).toBe('audio/wav');
    expect(normaliseMime('audio/wave')).toBe('audio/wav');
    expect(normaliseMime('audio/x-m4a')).toBe('audio/mp4');
    expect(normaliseMime('audio/mp3')).toBe('audio/mpeg');
  });

  it('ignores case, whitespace and parameters', () => {
    expect(normaliseMime(' Image/PNG ')).toBe('image/png');
    expect(normaliseMime('audio/X-WAV; codecs=1')).toBe('audio/wav');
    expect(normaliseMime('video/mp4')).toBe('video/mp4');
  });
});

describe('canonicalMime', () => {
  it('reads an MP4 container as audio for an audio asset only', () => {
    expect(canonicalMime('audio', 'video/mp4')).toBe('audio/mp4');
    expect(canonicalMime('background', 'video/mp4')).toBe('video/mp4');
    expect(canonicalMime('audio', null)).toBeNull();
  });
});

describe('ASSET_RULES', () => {
  it('never accepts SVG or anything outside images, video, audio and fonts', () => {
    for (const type of ASSET_TYPES)
      for (const mime of ASSET_RULES[type].mimes) expect(mime).toMatch(/^(image|video|audio|font)\//);
    expect(ASSET_TYPES.flatMap((t) => ASSET_RULES[t].mimes)).not.toContain('image/svg+xml');
  });

  it('gives video more room than images where both are accepted', () => {
    expect(assetMaxBytes('intro', 'image/png')).toBe(25_000_000);
    expect(assetMaxBytes('intro', 'video/mp4')).toBe(200_000_000);
    expect(assetMaxBytes('background', 'video/webm')).toBe(200_000_000);
    expect(assetMaxBytes('audio', 'audio/mpeg')).toBe(50_000_000);
  });
});

describe('assetUploadSchema', () => {
  const png = { type: 'overlay', name: ' Gold frame ', mime: 'image/png', bytes: 1200, width: 1080, height: 1920 };
  const codes = (input: unknown) => {
    const r = assetUploadSchema.safeParse(input);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it('accepts a valid upload and trims the name', () => {
    const r = assetUploadSchema.parse(png);
    expect(r.name).toBe('Gold frame');
    expect(r.mime).toBe('image/png');
  });

  it('normalises the mime it stores', () => {
    const r = assetUploadSchema.parse({
      type: 'audio',
      name: 'Beat',
      mime: 'audio/x-wav',
      bytes: 4_000_000,
      durationMs: 90_000,
    });
    expect(r.mime).toBe('audio/wav');
  });

  it('refuses a format the type does not take', () => {
    expect(codes({ ...png, mime: 'image/jpeg' })).toEqual(['wrong_type']); // overlays are PNG or WebP
    expect(codes({ ...png, type: 'logo', mime: 'image/svg+xml' })).toEqual(['wrong_type']);
    expect(codes({ ...png, type: 'font', mime: 'image/png' })).toEqual(['wrong_type']);
    expect(codes({ ...png, mime: 'text/html' })).toEqual(['wrong_type']);
  });

  it('enforces the size limit per type and format', () => {
    expect(codes({ ...png, bytes: 25_000_000 })).toEqual([]);
    expect(codes({ ...png, bytes: 25_000_001 })).toEqual(['too_big']);
    expect(codes({ ...png, type: 'logo', bytes: 10_000_001 })).toEqual(['too_big']);
    expect(codes({ type: 'font', name: 'Sans', mime: 'font/woff2', bytes: 10_000_001 })).toEqual(['too_big']);
    const video = { type: 'intro', name: 'Intro', mime: 'video/mp4', durationMs: 5000 };
    expect(codes({ ...video, bytes: 200_000_000 })).toEqual([]);
    expect(codes({ ...video, bytes: 200_000_001 })).toEqual(['too_big']);
    expect(codes({ ...video, mime: 'image/png', bytes: 25_000_001 })).toEqual(['too_big']);
  });

  it('enforces the duration limit of videos and audio', () => {
    const intro = { type: 'outro', name: 'Outro', mime: 'video/quicktime', bytes: 9_000_000 };
    expect(codes({ ...intro, durationMs: 30_000 })).toEqual([]);
    expect(codes({ ...intro, durationMs: 30_001 })).toEqual(['too_long']);
    expect(codes(intro)).toEqual(['too_long']); // an unmeasured video cannot be checked
    const song = { type: 'audio', name: 'Song', mime: 'audio/mpeg', bytes: 8_000_000 };
    expect(codes({ ...song, durationMs: 900_000 })).toEqual([]);
    expect(codes({ ...song, durationMs: 900_001 })).toEqual(['too_long']);
    // Backgrounds have no duration limit, and images and fonts have no duration at all.
    expect(
      codes({ type: 'background', name: 'Loop', mime: 'video/mp4', bytes: 9_000_000, durationMs: 600_000 }),
    ).toEqual([]);
    expect(codes({ ...png, durationMs: 99 })).toEqual([]);
  });

  it('rejects malformed fields with stable codes', () => {
    expect(codes({ ...png, name: '   ' })).toContain('invalid_name');
    expect(codes({ ...png, name: 'x'.repeat(121) })).toContain('invalid_name');
    expect(codes({ ...png, bytes: 0 })).toContain('invalid_size');
    expect(codes({ ...png, bytes: 1.5 })).toContain('invalid_size');
    expect(codes({ ...png, type: 'sticker' })).toContain('invalid_asset_type');
    expect(codes({ ...png, width: 0 }).length).toBeGreaterThan(0);
    expect(codes({ ...png, durationMs: -1 }).length).toBeGreaterThan(0);
    expect(codes(null).length).toBeGreaterThan(0);
    expect(codes({}).length).toBeGreaterThan(0);
  });
});
