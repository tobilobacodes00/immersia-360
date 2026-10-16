import type { BoothDB, CaptureTrigger, LocalTake } from './db';

/**
 * Take lifecycle on the device. A take is registered as `recording` BEFORE the first byte is
 * written, so if the page dies mid-take the record still exists and `recoverInterrupted` turns it
 * into a usable take (everything up to the last flushed chunk).
 */
export async function beginTake(
  db: BoothDB,
  t: Pick<LocalTake, 'id' | 'eventId' | 'deviceId' | 'path' | 'mimeType' | 'trigger' | 'width' | 'height' | 'fps'>,
): Promise<LocalTake> {
  const now = Date.now();
  const take: LocalTake = {
    ...t,
    status: 'recording',
    bytes: 0,
    chunks: 0,
    durationMs: 0,
    capturedAt: now,
    updatedAt: now,
  };
  await db.takes.put(take);
  return take;
}

/** Record progress after each persisted chunk, so a recovered take knows how much it has. */
export async function noteChunk(db: BoothDB, id: string, bytes: number, elapsedMs: number): Promise<void> {
  await db.takes
    .where('id')
    .equals(id)
    .modify((t) => {
      t.bytes += bytes;
      t.chunks += 1;
      t.durationMs = Math.max(t.durationMs, Math.round(elapsedMs));
      t.updatedAt = Date.now();
    });
}

export async function completeTake(db: BoothDB, id: string, durationMs: number): Promise<void> {
  await db.takes.update(id, { status: 'recorded', durationMs, updatedAt: Date.now() });
}

export async function failTake(db: BoothDB, id: string, error: string): Promise<void> {
  await db.takes.update(id, { status: 'failed', error, updatedAt: Date.now() });
}

/**
 * After a crash or reload: any take still `recording` was cut short. Takes with data become
 * `interrupted` (kept and renderable); empty ones are marked failed.
 */
export async function recoverInterrupted(db: BoothDB): Promise<LocalTake[]> {
  const stuck = await db.takes.where('status').equals('recording').toArray();
  const now = Date.now();
  for (const t of stuck) {
    if (t.chunks > 0) await db.takes.update(t.id, { status: 'interrupted', recoveredAt: now, updatedAt: now });
    else await db.takes.update(t.id, { status: 'failed', error: 'no data recorded', updatedAt: now });
  }
  return stuck.filter((t) => t.chunks > 0);
}

export async function importTake(
  db: BoothDB,
  t: Pick<
    LocalTake,
    'id' | 'eventId' | 'deviceId' | 'path' | 'mimeType' | 'bytes' | 'durationMs' | 'width' | 'height' | 'fps'
  >,
): Promise<LocalTake> {
  const now = Date.now();
  const take: LocalTake = {
    ...t,
    status: 'imported',
    trigger: 'import' satisfies CaptureTrigger,
    chunks: 1,
    capturedAt: now,
    updatedAt: now,
  };
  await db.takes.put(take);
  return take;
}

export function takesForEvent(db: BoothDB, eventId: string) {
  return db.takes.where('[eventId+capturedAt]').between([eventId, 0], [eventId, Infinity]).reverse().toArray();
}
