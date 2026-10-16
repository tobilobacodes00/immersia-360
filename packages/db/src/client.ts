import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { relations } from './relations';

/**
 * One driver everywhere: node-postgres over TCP. Neon accepts standard Postgres connections, so the
 * same code runs against Neon on Vercel (Fluid compute keeps the pool warm across invocations), a
 * plain Postgres service in CI, and a self-hosted database. Interactive transactions work in all
 * three, which event duplication, code reservation and session registration rely on.
 */
export function createPool(connectionString: string) {
  return new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function createDb(pool: Pool) {
  return drizzle({ client: pool, relations });
}

export type Database = ReturnType<typeof createDb>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

let cached: { pool: Pool; db: Database } | undefined;

/** The app's database, created on first use from DATABASE_URL. */
export function db(): Database {
  return connection().db;
}

/** The underlying pool, e.g. for `attachDatabasePool` on Vercel. */
export function pool(): Pool {
  return connection().pool;
}

function connection() {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const p = createPool(url);
    cached = { pool: p, db: createDb(p) };
  }
  return cached;
}
