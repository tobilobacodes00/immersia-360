/**
 * The decisions behind erasing a guest session (GDPR Art. 17 / NDPA), kept free of the database and
 * the storage SDK so they can be tested on their own. server/erasure.ts applies them.
 */
import type { RemovalBasis } from '@immersia/shared/reports';
import { isPlatformRemoval, removalOf } from './share-state';

/**
 * Upload URLs handed to a booth are valid for an hour (storage.presignUpload). A booth that
 * registered the session before it was erased may still PUT a file after it, and storage cannot
 * revoke a signed URL. So erased sessions keep their output rows (which hold the object keys) for
 * this long after erasure, and the sweep deletes those keys again before dropping the rows. Two
 * hours covers the hour of validity with a margin for clock drift and slow connections.
 */
export const LATE_UPLOAD_GRACE_MS = 2 * 60 * 60 * 1000;

export interface ErasableSession {
  erasedAt: Date | null;
  expiredAt: Date | null;
}

/** The change erasure makes to the session row. */
export interface ErasurePatch {
  erasedAt: Date;
  /** Keeps an earlier expiry time when the sweep already ended the session. */
  expiredAt: Date;
  status: 'expired';
  /** Taken off every screen for good: even an operator cannot put it back on one. */
  optedOutOfDisplay: true;
  displayStatus: 'opted_out';
}

export type ErasurePlan = { already: true } | { already: false; patch: ErasurePatch };

/**
 * What erasing a session does. Erasing twice is harmless: the second call finds `erasedAt` set and
 * changes nothing, whichever of the guest, the operator or a retried request comes second.
 */
export function erasurePlan(session: ErasableSession, now: Date): ErasurePlan {
  if (session.erasedAt) return { already: true };
  return {
    already: false,
    patch: {
      erasedAt: now,
      expiredAt: session.expiredAt ?? now,
      status: 'expired',
      optedOutOfDisplay: true,
      displayStatus: 'opted_out',
    },
  };
}

/** The same patch as the row will have after the erasure, for the in-memory side of a transaction. */
export function applyErasure<T extends ErasableSession>(session: T, plan: ErasurePlan): T {
  return plan.already ? session : { ...session, ...plan.patch };
}

/**
 * Why a booth's upload for a session is refused. The one guard for both ways a session becomes final:
 * erased by its guest, or taken down by the platform. Whatever the booth sends for such a session is
 * discarded and the session is never resurrected; the booth treats the answer as final and settles
 * the session quietly instead of retrying (the codes `session_erased` and `session_removed`, see
 * the upload queue). An operator's own hide is not a refusal: it is reversible and touches no files,
 * so the booth keeps uploading and a restore finds everything there. A takedown is reported ahead of
 * an erasure, the same precedence the guest's link uses (share-state.ts).
 */
export type UploadRefusal = 'removed' | 'erased';

export function uploadGate(session: {
  erasedAt: Date | null;
  removedAt?: Date | null;
  removal?: RemovalBasis | null;
}): 'ok' | UploadRefusal {
  if (isPlatformRemoval(removalOf(session))) return 'removed';
  return session.erasedAt ? 'erased' : 'ok';
}

/**
 * Where an erased session is in its cleanup. Objects are deleted immediately and again on every
 * sweep; the output rows (the only record of the keys) go once no signed upload can still land.
 */
export function purgeStage(erasedAt: Date, now: Date = new Date()): 'objects' | 'rows' {
  return now.getTime() - erasedAt.getTime() >= LATE_UPLOAD_GRACE_MS ? 'rows' : 'objects';
}
