import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { nextCookies } from 'better-auth/next-js';
import { magicLink, organization } from 'better-auth/plugins';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { ac, roles } from '@/lib/permissions';
import { checkNotOrphaned, checkOwnerKept, isSingleRole } from '@/lib/team-rules';
import { appOrigin, env } from './env';
import { localeFromRequest, sendInvitationEmail, sendMagicLinkEmail } from './email';
import { assertInviteBudget, inviterLocale, spendInviteBudget } from './invitation-policy';
import { ruleError } from './team-errors';
import { loadRoster, organizationCountOf } from './team-data';

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
        // ACC-3: an invitation is good for a week; a re-send starts the week again.
        invitationExpiresIn: 7 * 24 * 60 * 60,
        // Inviting an address that already has a pending invitation replaces it (and its role).
        cancelPendingInvitationsOnReInvite: true,
        // Every invitation email, new or re-sent, through the server action or a hand-made request:
        // counted against the abuse limits, and written in the inviter's language.
        sendInvitationEmail: async (data, request) => {
          await spendInviteBudget(data.inviter.user.id, data.email, request);
          await sendInvitationEmail(data.email, `${appOrigin()}/invite/${data.id}`, await inviterLocale(request), {
            inviter: data.inviter.user.name || data.inviter.user.email,
            organization: data.organization.name,
            role: data.role,
          });
        },
        // The team rules (lib/team-rules.ts) hold on every path into the plugin, not just our
        // server actions. The database trigger `org_keeps_owner` is the concurrency-proof backstop.
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation, inviter }) => {
            if (!isSingleRole(invitation.role)) throw ruleError('invalid_role');
            await assertInviteBudget(inviter.id, invitation.email);
          },
          beforeUpdateMemberRole: async ({ member, newRole }) => {
            if (!isSingleRole(newRole)) throw ruleError('invalid_role');
            const kept = checkOwnerKept(await loadRoster(member.organizationId), member.id, newRole);
            if (!kept.ok) throw ruleError(kept.error);
          },
          beforeRemoveMember: async ({ member }) => {
            const kept = checkOwnerKept(await loadRoster(member.organizationId), member.id, null);
            if (!kept.ok) throw ruleError(kept.error);
            const orphaned = checkNotOrphaned(await organizationCountOf(member.userId));
            if (!orphaned.ok) throw ruleError(orphaned.error);
          },
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
