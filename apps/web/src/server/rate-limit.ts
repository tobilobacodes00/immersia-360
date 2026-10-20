import 'server-only';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { headers } from 'next/headers';
import { env } from './env';

/**
 * Rate limits (DL-14: short-code lookups per IP and per event; Abuse: uploads and share links).
 * Upstash in production (shared across every serverless instance); without it, a bounded
 * in-process sliding window — correct for a single instance (dev, CI, self-hosted single node).
 */
export interface Limit {
  /** Requests allowed per window. */
  limit: number;
  windowS: number;
}

export const LIMITS = {
  codeLookupPerIp: { limit: 30, windowS: 60 },
  codeLookupPerEvent: { limit: 600, windowS: 60 },
  codeMissPerIp: { limit: 10, windowS: 300 },
  downloadPerIp: { limit: 300, windowS: 60 },
  /** SHR-2: a booth can't be turned into a mailer. */
  emailPerSession: { limit: 5, windowS: 3600 },
  emailPerDevice: { limit: 120, windowS: 3600 },
  /** Each asset upload is a database row and a presigned URL: bound them per organization. */
  assetUploadPerOrg: { limit: 300, windowS: 3600 },
  /** LIV-1: a six-character pairing code must not be guessable by brute force. */
  displayPairPerIp: { limit: 20, windowS: 600 },
  /** SHR-5: gallery passwords are short; slow guessing right down. */
  galleryUnlockPerIp: { limit: 10, windowS: 600 },
  /** POST /api/t: batches per booth, display or operator (a booth flushes every ~10 s while busy)… */
  analyticsIngest: { limit: 120, windowS: 60 },
  /** …and per address, so one network full of booths is not throttled by a single bad actor's key. */
  analyticsIngestIp: { limit: 900, windowS: 60 },
  /** Abuse: a report per reporter (a salted daily hash, never the address), per session, and per event. */
  reportPerReporter: { limit: 5, windowS: 86_400 },
  reportPerSession: { limit: 10, windowS: 3600 },
  reportPerEvent: { limit: 60, windowS: 3600 },
} satisfies Record<string, Limit>;

type Name = keyof typeof LIMITS;

let upstash: Map<Name, Ratelimit> | null | undefined;

function upstashLimiters(): Map<Name, Ratelimit> | null {
  if (upstash !== undefined) return upstash;
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = env();
  if (!url || !token) {
    // Per-instance memory is no real limit across serverless instances: say so loudly in production.
    if (process.env.VERCEL_ENV === 'production')
      console.error('[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN are not set: limits only apply per instance');
    return (upstash = null);
  }
  const redis = new Redis({ url, token });
  upstash = new Map(
    (Object.keys(LIMITS) as Name[]).map((name) => [
      name,
      new Ratelimit({
        redis,
        prefix: `rl:${name}`,
        limiter: Ratelimit.slidingWindow(LIMITS[name].limit, `${LIMITS[name].windowS} s`),
        analytics: false,
      }),
    ]),
  );
  return upstash;
}

const memory = new Map<string, number[]>();
const MEMORY_KEYS = 50_000;

function memoryCheck(name: Name, key: string): boolean {
  const { limit, windowS } = LIMITS[name];
  const now = Date.now();
  const id = `${name}:${key}`;
  const hits = (memory.get(id) ?? []).filter((t) => now - t < windowS * 1000);
  const allowed = hits.length < limit;
  if (allowed) hits.push(now);
  memory.delete(id);
  memory.set(id, hits);
  // Bounded: drop the oldest keys (Map keeps insertion order).
  while (memory.size > MEMORY_KEYS) memory.delete(memory.keys().next().value!);
  return allowed;
}

/** True when the request may proceed. Fails open on a limiter outage (availability over strictness). */
export async function allow(name: Name, key: string): Promise<boolean> {
  const limiters = upstashLimiters();
  if (!limiters) return memoryCheck(name, key);
  try {
    return (await limiters.get(name)!.limit(key)).success;
  } catch (err) {
    console.error('[rate-limit] limiter unavailable', err);
    return true;
  }
}

/** True while budget remains, without spending any (e.g. "has this IP used up its misses?"). */
export async function hasBudget(name: Name, key: string): Promise<boolean> {
  const limiters = upstashLimiters();
  if (!limiters) {
    const { limit, windowS } = LIMITS[name];
    const now = Date.now();
    return (memory.get(`${name}:${key}`) ?? []).filter((t) => now - t < windowS * 1000).length < limit;
  }
  try {
    return (await limiters.get(name)!.getRemaining(key)).remaining > 0;
  } catch (err) {
    console.error('[rate-limit] limiter unavailable', err);
    return true;
  }
}

/** The caller's IP as Vercel/proxies report it. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}
