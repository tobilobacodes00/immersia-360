import 'server-only';
import { z } from 'zod';

/**
 * Server environment, validated on first use (not at import, so `next build` works without
 * secrets). Optional integrations degrade gracefully: no Google keys hides the Google button, no
 * Resend key outside production routes mail to the dev mailbox.
 */
const schema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.url().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  /** e.g. smtps://booth%40gmail.com:app-password@smtp.gmail.com:465 */
  SMTP_URL: z.url().optional(),
  EMAIL_FROM: z.string().min(3).default('Immersia 360 <onboarding@resend.dev>'),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  /** Enables test-only endpoints (the e2e mailbox). Refused on any Vercel deployment. */
  E2E: z.enum(['0', '1']).default('0'),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid server environment:\n${z.prettifyError(parsed.error)}`);
    }
    if (parsed.data.E2E === '1' && process.env.VERCEL_ENV) {
      throw new Error('E2E test mode must never be enabled on a Vercel deployment');
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProduction = () => process.env.VERCEL_ENV === 'production';

/** Public origin of this deployment, for links in emails and QR codes. */
export function appOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.BETTER_AUTH_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}
