import Dexie, { type EntityTable } from 'dexie';

/**
 * The booth's on-device database (NFR Offline). Everything a booth needs to keep working with no
 * network lives here: the cached event bundle, takes and their status, guest sessions and outputs,
 * the upload queue, and the reserved short-code pool. Media bytes live in OPFS (take-store.ts).
 */

export type TakeStatus = 'recording' | 'recorded' | 'interrupted' | 'imported' | 'rendering' | 'rendered' | 'failed';
export type CaptureTrigger = 'tap' | 'timer' | 'motion' | 'remote' | 'keyboard' | 'import';

export interface LocalTake {
  id: string;
  eventId: string;
  deviceId: string | null;
  /** Path of the raw file in the take store. */
  path: string;
  mimeType: string;
  status: TakeStatus;
  trigger: CaptureTrigger;
  bytes: number;
  chunks: number;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  capturedAt: number;
  updatedAt: number;
  /** Set when a recording was cut short by a crash or reload and recovered. */
  recoveredAt?: number;
  error?: string;
}

export type OutputKind = 'mp4' | 'small_mp4' | 'gif' | 'strip' | 'short_video' | 'boomerang' | 'poster';

/** A guest-facing file rendered on this device (M3), kept until uploaded and expired. */
export interface LocalOutput {
  id: string;
  takeId: string;
  eventId: string;
  kind: OutputKind;
  path: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  durationMs: number;
  renderMs?: number;
  createdAt: number;
}

export interface CachedEvent {
  id: string;
  /** The full event bundle as last fetched (settings, branding, assets index). */
  data: unknown;
  cachedAt: number;
}

export interface FallbackChunk {
  /** `${path}#${index}` */
  key: string;
  path: string;
  index: number;
  data: Blob;
}

export interface KeyValue {
  key: string;
  value: unknown;
}

export class BoothDB extends Dexie {
  takes!: EntityTable<LocalTake, 'id'>;
  outputs!: EntityTable<LocalOutput, 'id'>;
  events!: EntityTable<CachedEvent, 'id'>;
  chunks!: EntityTable<FallbackChunk, 'key'>;
  kv!: EntityTable<KeyValue, 'key'>;

  constructor(name = 'immersia-booth') {
    super(name);
    this.version(1).stores({
      takes: 'id, eventId, status, capturedAt, [eventId+capturedAt]',
      events: 'id',
      chunks: 'key, path',
      kv: 'key',
    });
    // v2 (M3): rendered outputs.
    this.version(2).stores({
      outputs: 'id, takeId, eventId, kind, [eventId+createdAt]',
    });
  }
}

let instance: BoothDB | undefined;

export function boothDb(): BoothDB {
  instance ??= new BoothDB();
  return instance;
}
