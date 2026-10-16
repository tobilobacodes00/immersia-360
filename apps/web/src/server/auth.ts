import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { nextCookies } from 'better-auth/next-js';
import { magicLink, organization } from 'better-auth/plugins';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { ac, roles } from '@/lib/permissions';
import { appOrigin, env } from './env';
import { localeFromRequest, sendInvitationEmail, sendMagicLinkEmail } from './email';

const AUTH_TABLES = {
  user: schema.user,
  session: schema.session,
  account: schema.account,
  verification: schema.verification,
  organization: schema.organization,
  member: schema.member,
  invitation: schema.invitation,
};

function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const suffix = crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36).slice(0, 5);
  return `${base || 'studio'}-${suffix}`;
}

/** Every operator gets an organization (the PRD's "Account": one per booth business) on sign-up. */
async function createPersonalOrganization(user: { id: string; name?: string | null; email: string }) {
  const name = user.name?.trim() || user.email.split('@')[0] || 'My studio';
  const orgId = crypto.randomUUID();
  await db().transaction(async (tx) => {
    await tx.insert(schema.organization).values({ id: orgId, name, slug: slugify(name) });
    await tx
      .insert(schema.member)
      .values({ id: crypto.randomUUID(), organizationId: orgId, userId: user.id, role: 'owner' });
  });
}

async function firstOrganizationOf(userId: string): Promise<string | null> {
  const [row] = await db()
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.member.createdAt))
    .limit(1);
  return row?.organizationId ?? null;
}

function createAuth() {
  const e = env();
  const google =
    e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: e.GOOGLE_CLIENT_ID,
            clientSecret: e.GOOGLE_CLIENT_SECRET,
            prompt: 'select_account' as const,
          },
        }
      : undefined;
  return betterAuth({
    appName: 'Immersia 360',
    baseURL: appOrigin(),
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), { provider: 'pg', schema: AUTH_TABLES, transaction: true }),
    session: {
      // Long sessions: an operator signs in on a booth device once and runs events for weeks.
      expiresIn: 60 * 60 * 24 * 60,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    socialProviders: google,
    account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
    // E2E signs many users in from one IP; production keeps strict limits.
    rateLimit: { enabled: e.E2E !== '1', window: 60, max: 60 },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        rateLimit: e.E2E === '1' ? { window: 60, max: 1000 } : { window: 60, max: 5 },
        sendMagicLink: async ({ email, url }, ctx) => {
          await sendMagicLinkEmail(email, url, localeFromRequest(ctx?.request?.headers));
        },
      }),
      organization({
        ac,
        roles,
        creatorRole: 'owner',
        invitationExpiresIn: 7 * 24 * 60 * 60,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async (data, request) => {
          await sendInvitationEmail(
            data.email,
            `${appOrigin()}/invite/${data.id}`,
            localeFromRequest(request?.headers),
            {
              inviter: data.inviter.user.name || data.inviter.user.email,
              organization: data.organization.name,
              role: data.role,
            },
          );
        },
      }),
      nextCookies(),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await createPersonalOrganization(user);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const activeOrganizationId = await firstOrganizationOf(session.userId);
            return { data: { ...session, activeOrganizationId } };
          },
        },
      },
    },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** The Better Auth instance, created on first use so builds need no secrets. */
export function auth() {
  instance ??= createAuth();
  return instance;
}

export const googleEnabled = () => {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
};
