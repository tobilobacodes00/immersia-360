import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RegisterSessionInput, RegisterSessionResult, UploadTicket } from '@immersia/shared';
import { BoothDB, type LocalTake } from '../src/db';
import { putOutput } from '../src/outputs';
import {
  CODE_POOL_BATCH,
  CODE_POOL_LOW,
  codesLeft,
  mintSession,
  optOutOfDisplay,
  queueEmail,
  takeCode,
  topUpCodes,
} from '../src/sessions';
import { createIdbTakeStore, type TakeStore } from '../src/take-store';
import { BoothApiError, UploadQueue, backoffMs, type BoothApi } from '../src/uploader';

let db: BoothDB;
let store: TakeStore;
let n = 0;
let clock = 1_000_000;
const now = () => clock;

beforeEach(async () => {
  db = new BoothDB(`uploader-${++n}`);
  await db.open();
  store = createIdbTakeStore(db);
  clock = 1_000_000;
});

/** An in-memory server with the same contract as /api/booth/*. */
class FakeServer implements BoothApi {
  sessions = new Map<string, RegisterSessionInput>();
  /** serverOutputId → what the server knows; "confirmed" is set by a successful complete. */
  outputs = new Map<
    string,
    { kind: string; takeId: string | null; bytes: number; stored: number | null; confirmed: boolean }
  >();
  calls: string[] = [];
  failNext: BoothApiError | Error | null = null;

  private maybeFail(call: string) {
    this.calls.push(call);
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }

  async registerSession(input: RegisterSessionInput): Promise<RegisterSessionResult> {
    this.maybeFail('register');
    this.sessions.set(input.id, input);
    for (const o of input.outputs) {
      const clash = [...this.outputs.values()].some((x) => x.kind === o.kind && x.takeId === o.takeId);
      if (!this.outputs.has(o.id) && !clash)
        this.outputs.set(o.id, { kind: o.kind, takeId: o.takeId, bytes: o.bytes, stored: null, confirmed: false });
    }
    const uploads: UploadTicket[] = [...this.outputs.entries()]
      .filter(([, o]) => !o.confirmed && input.outputs.some((x) => x.kind === o.kind && x.takeId === o.takeId))
      .map(([id, o]) => ({
        outputId: id,
        kind: o.kind as UploadTicket['kind'],
        takeId: o.takeId,
        url: `put:${id}`,
        method: 'PUT',
        headers: {},
      }));
    return { shortCode: input.shortCode ?? 'SRV234', filenamePrefix: '', uploads };
  }

  async put(ticket: UploadTicket, body: Blob): Promise<void> {
    this.maybeFail(`put:${ticket.kind}`);
    this.outputs.get(ticket.outputId)!.stored = body.size;
  }

  emails: string[] = [];
  async sendEmail(sessionId: string, to: string) {
    this.maybeFail('email');
    if (!this.sessions.has(sessionId)) throw new BoothApiError(404, 'not_found', false);
    this.emails.push(to);
  }

  optedOut: string[] = [];
  async optOutOfDisplay(sessionId: string) {
    this.maybeFail('optOut');
    if (!this.sessions.has(sessionId)) throw new BoothApiError(404, 'not_found', false);
    this.optedOut.push(sessionId);
  }

  async complete(outputId: string) {
    this.maybeFail('complete');
    const o = this.outputs.get(outputId);
    if (!o) return 'not_found' as const;
    if (o.stored !== o.bytes) return 'incomplete' as const;
    o.confirmed = true;
    return 'ok' as const;
  }
}

async function addTake(id: string, status: LocalTake['status'] = 'rendering') {
  await db.takes.put({
    id,
    eventId: 'evt',
    deviceId: 'dev',
    path: `takes/evt/${id}.webm`,
    mimeType: 'video/webm',
    status,
    trigger: 'tap',
    bytes: 10,
    chunks: 1,
    durationMs: 8000.4,
    width: 1920,
    height: 1080,
    fps: 29.97,
    capturedAt: clock,
    updatedAt: clock,
  });
}

const addOutput = (takeId: string, kind: 'mp4' | 'small_mp4' | 'poster', size: number) =>
  putOutput(db, store, {
    takeId,
    eventId: 'evt',
    kind,
    blob: new Blob([new Uint8Array(size)], { type: kind === 'poster' ? 'image/jpeg' : 'video/mp4' }),
    width: 1080,
    height: 1920,
    durationMs: kind === 'poster' ? 0 : 16000,
  });

/** Run the queue until it has nothing due. */
async function drain(queue: UploadQueue, max = 20) {
  const steps: string[] = [];
  for (let i = 0; i < max; i++) {
    const step = await queue.runOnce();
    if (step.kind === 'idle') break;
    steps.push(step.kind === 'uploaded' ? `uploaded:${(await db.outputs.get(step.outputId))!.kind}` : step.kind);
  }
  return steps;
}

describe('short-code pool (DL-2)', () => {
  it('tops up only when low, and hands out the oldest code first', async () => {
    const asked: number[] = [];
    let k = 0;
    const reserve = async (_e: string, count: number) => {
      asked.push(count);
      return Array.from({ length: count }, () => `C${String(k++).padStart(5, '0')}`);
    };
    expect(await topUpCodes(db, reserve, 'evt')).toBe(CODE_POOL_BATCH);
    expect(await topUpCodes(db, reserve, 'evt')).toBe(0);
    expect(asked).toEqual([CODE_POOL_BATCH]);
    expect(await takeCode(db, 'evt')).toBe('C00000');
    expect(await takeCode(db, 'evt')).toBe('C00001');
    expect(await takeCode(db, 'other')).toBeNull();
    // Drained below the threshold, it asks again.
    for (let i = 0; i < CODE_POOL_BATCH - CODE_POOL_LOW; i++) await takeCode(db, 'evt');
    expect(await codesLeft(db, 'evt')).toBeLessThan(CODE_POOL_LOW);
    expect(await topUpCodes(db, reserve, 'evt')).toBe(CODE_POOL_BATCH);
  });

  it('mints a session with a link id even with an empty pool (offline, dry)', async () => {
    const s = await mintSession(db, { eventId: 'evt', takeIds: ['t1'], capturedAt: clock });
    expect(s.linkId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(s.shortCode).toBeNull();
    expect(s.state).toBe('local');
  });
});

describe('upload queue', () => {
  it('registers early, uploads poster before the video, and finishes once renders settle', async () => {
    const server = new FakeServer();
    const queue = new UploadQueue(db, store, server, now);
    await addTake('t1', 'rendering');
    const session = await mintSession(db, { eventId: 'evt', takeIds: ['t1'], capturedAt: clock });

    // Nothing rendered yet: registered (the share page can say "on their way"), then waits.
    expect(await drain(queue)).toEqual(['registered']);
    expect(server.sessions.get(session.id)!.takes[0]).toMatchObject({ fps: 30, durationMs: 8000 });

    await addOutput('t1', 'mp4', 5000);
    await addOutput('t1', 'poster', 300);
    await db.takes.update('t1', { status: 'rendered' });
    await queue.nudge('t1');
    expect(await drain(queue)).toEqual(['registered', 'uploaded:poster', 'uploaded:mp4', 'done']);
    expect((await db.sessions.get(session.id))!.state).toBe('done');
    expect([...server.outputs.values()].every((o) => o.confirmed)).toBe(true);
  });

  it('backs off on a network error and resumes when due', async () => {
    const server = new FakeServer();
    const queue = new UploadQueue(db, store, server, now);
    await addTake('t1', 'rendered');
    await addOutput('t1', 'mp4', 1000);
    const session = await mintSession(db, { eventId: 'evt', takeIds: ['t1'], capturedAt: clock });

    server.failNext = new TypeError('Failed to fetch');
    const step = await queue.runOnce();
    expect(step).toMatchObject({ kind: 'retry', error: 'Failed to fetch' });
    expect((await db.sessions.get(session.id))!.attempts).toBe(1);
    expect(await queue.runOnce()).toEqual({ kind: 'idle' }); // not due yet

    clock += backoffMs(1, () => 1) + 1;
    expect(await drain(queue)).toEqual(['registered', 'uploaded:mp4', 'done']);
  });

  it('parks a session the server rejects, and stops on a revoked device', async () => {
    const server = new FakeServer();
    const queue = new UploadQueue(db, store, server, now);
    await addTake('t1', 'rendered');
    const a = await mintSession(db, { eventId: 'evt', takeIds: ['t1'], capturedAt: clock });

    server.failNext = new BoothApiError(404, 'not_found', false);
    expect(await queue.runOnce()).toMatchObject({ kind: 'failed', error: 'not_found' });
    expect((await db.sessions.get(a.id))!.state).toBe('failed');

    await addTake('t2', 'rendered');
    const b = await mintSession(db, { eventId: 'evt', takeIds: ['t2'], capturedAt: clock });
    server.failNext = new BoothApiError(401, 'device_unauthorized', false);
    expect(await queue.runOnce()).toEqual({ kind: 'revoked' });
    expect((await db.sessions.get(b.id))!.state).toBe('local'); // untouched: re-registering the device resumes it
  });

  it('survives a reload between registration and upload, and skips what the server already has', async () => {
    const server = new FakeServer();
    await addTake('t1', 'rendered');
    await addOutput('t1', 'poster', 300);
    await addOutput('t1', 'mp4', 2000);
    await mintSession(db, { eventId: 'evt', takeIds: ['t1'], capturedAt: clock });

    const first = new UploadQueue(db, store, server, now);
    expect(await first.runOnce()).toMatchObject({ kind: 'registered' });
    expect(await first.runOnce()).toMatchObject({ kind: 'uploaded' }); // poster

    // Reload: a new queue has no tickets in memory and registers again for fresh ones.
    const second = new UploadQueue(db, store, server, now);
    expect(await drain(second)).toEqual(['registered', 'uploaded:mp4', 'done']);
    expect(server.calls.filter((c) => c.startsWith('put:'))).toEqual(['put:poster', 'put:mp4']);
  });

  it('retries an upload the server could not confirm', async () => {
    const server = new FakeServer();
    const queue = new UploadQueue(db, store, server, now);
    await addTake('t1', 'rendered');
    await addOutput('t1', 'mp4', 1000);
    await mintSession(db, { eventId: 'evt', takeIds: ['t1'], capturedAt: clock });
    expect(await queue.runOnce()).toMatchObject({ kind: 'registered' });
    // The PUT "succeeds" but stores a truncated object.
    const realPut = server.put.bind(server);
    server.put = async (ticket, body) => realPut(ticket, body.slice(0, 10));
    expect(await queue.runOnce()).toMatchObject({ kind: 'retry', error: 'upload_incomplete' });
    server.put = realPut;
    clock += 600_000;
    expect(await drain(queue)).toEqual(['registered', 'uploaded:mp4', 'done']);
  });

  it('sends queued emails once registered, before uploads, and reopens a finished session for one', async () => {
    const server = new FakeServer();
    const queue = new UploadQueue(db, store, server, now);
    await addTake('t1', 'rendered');
    await addOutput('t1', 'mp4', 1000);
    const s = await mintSession(db, { eventId: 'evt', takeIds: ['t1'], capturedAt: clock });
    await queueEmail(db, s.id, ' Guest@Example.com ');
    expect(await drain(queue)).toEqual(['registered', 'emailed', 'uploaded:mp4', 'done']);
    expect(server.emails).toEqual(['guest@example.com']);

    await queueEmail(db, s.id, 'friend@example.com');
    expect(await drain(queue)).toEqual(['emailed', 'done']);
    expect(server.emails).toEqual(['guest@example.com', 'friend@example.com']);
  });

  it('a guest opting out of the display: sent with the registration, or later through the queue (LIV-8)', async () => {
    const server = new FakeServer();
    const queue = new UploadQueue(db, store, server, now);
    await addTake('t1', 'rendered');
    await addOutput('t1', 'mp4', 1000);
    const before = await mintSession(db, { eventId: 'evt', takeIds: ['t1'], capturedAt: clock });
    await optOutOfDisplay(db, before.id);
    expect(await drain(queue)).toEqual(['registered', 'uploaded:mp4', 'done']);
    expect(server.sessions.get(before.id)?.optedOutOfDisplay).toBe(true);
    expect(server.optedOut).toEqual([]);

    await addTake('t2', 'rendered');
    await addOutput('t2', 'mp4', 1000);
    const after = await mintSession(db, { eventId: 'evt', takeIds: ['t2'], capturedAt: clock });
    expect(await drain(queue)).toEqual(['registered', 'uploaded:mp4', 'done']);
    await optOutOfDisplay(db, after.id);
    expect(await drain(queue)).toEqual(['opted_out', 'done']);
    expect(server.optedOut).toEqual([after.id]);
  });

  it('a later output (the messaging copy) reopens a finished session', async () => {
    const server = new FakeServer();
    const queue = new UploadQueue(db, store, server, now);
    await addTake('t1', 'rendered');
    await addOutput('t1', 'mp4', 1000);
    await mintSession(db, { eventId: 'evt', takeIds: ['t1'], capturedAt: clock });
    expect(await drain(queue)).toEqual(['registered', 'uploaded:mp4', 'done']);

    await addOutput('t1', 'small_mp4', 400);
    await queue.nudge('t1');
    expect(await drain(queue)).toEqual(['registered', 'uploaded:small_mp4', 'done']);
  });

  it('uploads a photo session: no takes, outputs made for the session itself', async () => {
    const server = new FakeServer();
    const queue = new UploadQueue(db, store, server, now);
    const s = await mintSession(db, { eventId: 'evt', takeIds: [], capturedAt: clock });
    const add = (kind: 'strip' | 'gif', type: string, size: number) =>
      putOutput(db, store, {
        takeId: null,
        sessionId: s.id,
        eventId: 'evt',
        kind,
        blob: new Blob([new Uint8Array(size)], { type }),
        width: 600,
        height: 1800,
        durationMs: 0,
      });
    await add('strip', 'image/jpeg', 700);
    await add('gif', 'image/gif', 300);
    await queue.nudgeSession(s.id);
    expect(await drain(queue)).toEqual(['registered', 'uploaded:strip', 'uploaded:gif', 'done']);
    expect(server.sessions.get(s.id)!.outputs.every((o) => o.takeId === null)).toBe(true);
  });
});
