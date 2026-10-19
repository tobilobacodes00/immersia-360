import { describe, expect, it } from 'vitest';
import { newLinkId, uuidv7 } from '../src/ids';
import { OUTPUT_KINDS, UPLOAD_PRIORITY, registerSessionSchema, reserveCodesSchema } from '../src/session';

const take = () => ({
  id: uuidv7(),
  capturedAt: new Date().toISOString(),
  durationMs: 8000,
  fps: 60,
  width: 1920,
  height: 1080,
  trigger: 'tap' as const,
});

const output = (takeId: string | null) => ({
  id: uuidv7(),
  takeId,
  kind: 'mp4' as const,
  mime: 'video/mp4' as const,
  bytes: 9_000_000,
  width: 1080,
  height: 1920,
  durationMs: 16_000,
});

const session = (patch: Record<string, unknown> = {}) => {
  const t = take();
  return {
    id: uuidv7(),
    eventId: uuidv7(),
    linkId: newLinkId(),
    shortCode: 'K7M2QX',
    capturedAt: new Date().toISOString(),
    optedOutOfDisplay: false,
    takes: [t],
    outputs: [output(t.id)],
    ...patch,
  };
};

describe('session registration contract (DL-1)', () => {
  it('accepts what a booth sends', () => {
    expect(registerSessionSchema.safeParse(session()).success).toBe(true);
    // Offline with an empty pool: no code yet, the server assigns one.
    expect(registerSessionSchema.safeParse(session({ shortCode: null })).success).toBe(true);
  });

  it('rejects a malformed link id or short code', () => {
    expect(registerSessionSchema.safeParse(session({ linkId: 'short' })).success).toBe(false);
    // 0, O, 1, I and L are not in the alphabet.
    expect(registerSessionSchema.safeParse(session({ shortCode: 'K7M2Q0' })).success).toBe(false);
  });

  it('requires every output to come with its take', () => {
    const r = registerSessionSchema.safeParse(session({ outputs: [output(uuidv7())] }));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('output_take_missing');
    // A session-level output (a strip from several shots) has no take.
    expect(registerSessionSchema.safeParse(session({ outputs: [output(null)] })).success).toBe(true);
  });

  it('bounds what a device can ask for', () => {
    expect(reserveCodesSchema.safeParse({ eventId: uuidv7(), count: 300 }).success).toBe(true);
    expect(reserveCodesSchema.safeParse({ eventId: uuidv7(), count: 301 }).success).toBe(false);
  });
});

describe('upload priority', () => {
  it('ranks every kind, and what a guest sees first goes first', () => {
    for (const k of OUTPUT_KINDS) expect(UPLOAD_PRIORITY[k]).toBeTypeOf('number');
    expect(UPLOAD_PRIORITY.poster).toBeLessThan(UPLOAD_PRIORITY.small_mp4);
    expect(UPLOAD_PRIORITY.small_mp4).toBeLessThan(UPLOAD_PRIORITY.mp4);
  });
});
