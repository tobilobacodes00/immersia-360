import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { relations } from './relations';

/**
 * Neon over WebSockets (Pool): supports interactive transactions, which event duplication, code
 * reservation and session registration need. One pool per server instance.
 */
export function createDb(connectionString: string) {
  return drizzle({ client: new Pool({ connectionString }), relations });
}

export type Database = ReturnType<typeof createDb>;

let cached: Database | undefined;

/** The app's database, created on first use from DATABASE_URL. */
export function db(): Database {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    cached = createDb(url);
  }
  return cached;
}
