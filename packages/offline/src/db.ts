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
  /** Why a derived output (the messaging copy) couldn't be made; not retried automatically. */
  derivedError?: string;
}

export type OutputKind = 'mp4' | 'small_mp4' | 'gif' | 'strip' | 'short_video' | 'boomerang' | 'poster';

/** A guest-facing file rendered on this device (M3), kept until uploaded and expired. */
export interface LocalOutput {
  id: string;
  /** The take it was rendered from (360); null for session-level outputs (a photo strip, a GIF). */
  takeId: string | null;
  /** Session-level outputs belong to their guest session directly (photo booth, M5). */
  sessionId?: string;
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
  /** The server's id for this output once its session is registered (M4). */
  serverId?: string;
  /** Set when the upload is confirmed by the server (size checked). */
  uploadedAt?: number;
}

/**
 * A guest session (DL-1): one link and one short code for everything a guest made. Minted on the
 * device when the take is saved, so the QR exists with no network; the upload queue registers it
 * and uploads its outputs when it can.
 */
export interface LocalSession {
  id: string;
  eventId: string;
  /** 128-bit link id: the share URL and its access secret. */
  linkId: string;
  /** From this device's reserved pool; null when it ran dry offline (the server assigns one). */
  shortCode: string | null;
  takeIds: string[];
  capturedAt: number;
  optedOutOfDisplay: boolean;
  /** local → registered (server knows it) → done (every output uploaded); failed needs the operator. */
  state: 'local' | 'registered' | 'done' | 'failed';
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  /** SHR-2: addresses waiting to be sent the link (the device holds them only until sent). */
  pendingEmails?: string[];
  createdAt: number;
  updatedAt: number;
}

/** A short code reserved for this device while online, handed out offline (DL-2). */
export interface ReservedCode {
  code: string;
  eventId: string;
  reservedAt: number;
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
  sessions!: EntityTable<LocalSession, 'id'>;
  codes!: EntityTable<ReservedCode, 'code'>;

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
    // v3 (M4): guest sessions and the short-code pool.
    this.version(3).stores({
      sessions: 'id, eventId, linkId, state, *takeIds, [eventId+capturedAt]',
      codes: 'code, eventId, [eventId+reservedAt]',
    });
    // v4 (M5): session-level outputs (photo strips, GIFs) are found by their session.
    this.version(4).stores({
      outputs: 'id, takeId, sessionId, eventId, kind, [eventId+createdAt]',
    });
  }
}

let instance: BoothDB | undefined;

export function boothDb(): BoothDB {
  instance ??= new BoothDB();
  return instance;
}
