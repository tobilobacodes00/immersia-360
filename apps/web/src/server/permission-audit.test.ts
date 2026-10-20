import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { roleCan, type Permission } from '../lib/permissions';

/**
 * ACC-3: "Viewer is read-only everywhere". A source-level audit that fails when someone adds a
 * server action or an API route and forgets to say who may call it. It reads the code rather than
 * running it, so it is cheap, and it pins the decisions in one place:
 *
 *  - every exported function of a `'use server'` file is guarded (withOperator / withMember /
 *    withSession) or is on the short list of public, non-operator actions;
 *  - an action guarded by a permission that mutates (anything but read/export) names one the viewer
 *    does not hold; an action guarded only by read permissions is on the list of read-only actions;
 *  - every route handler under app/api is classified, and the operator ones check the permission.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const rel = (file: string) => relative(SRC, file).split(sep).join('/');

function walk(dir: string, match: (file: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, match, out);
    else if (match(path)) out.push(path);
  }
  return out;
}

/** `{ event: ['create'] }` as written in the source → a Permission. */
function parsePermission(literal: string): Permission {
  const json = literal.replace(/'/g, '"').replace(/([{,]\s*)([a-zA-Z_]+)\s*:/g, '$1"$2":');
  return JSON.parse(json) as Permission;
}

const READ_ONLY_VERBS = new Set(['read', 'export']);
const isMutating = (p: Permission) =>
  Object.values(p)
    .flat()
    .some((verb) => !READ_ONLY_VERBS.has(verb));

// ------------------------------------------------------------------------------------------------
// Server actions

/** Actions that touch no operator data: guests' code lookup, the language cookie. */
const PUBLIC_ACTIONS = new Set(['app/c/actions.ts#findCode', 'i18n/actions.ts#setLocale']);
/** Guarded by a read permission, and read-only. A mutating action must never be added here. */
const READ_ONLY_ACTIONS = new Set([
  'listAssetsAction',
  'templateLatestAction',
  'listLibraryAction',
  'listDisplaysAction',
  'moderationListsAction',
]);
/** Open to every member (or every signed-in user) about their own membership or invitation only. */
const SELF_SERVICE_ACTIONS = new Set([
  'leaveOrganizationAction',
  'switchOrganizationAction',
  'acceptInvitationAction',
  'declineInvitationAction',
]);

interface ActionSource {
  file: string;
  name: string;
  body: string;
}

const actionFiles = walk(SRC, (f) => /\.tsx?$/.test(f) && /^\s*['"]use server['"]/.test(readFileSync(f, 'utf8')));

function actionsOf(file: string): ActionSource[] {
  const source = readFileSync(file, 'utf8');
  const starts = [...source.matchAll(/^export async function (\w+)/gm)];
  return starts.map((m, i) => ({
    file: rel(file),
    name: m[1]!,
    body: source.slice(m.index, starts[i + 1]?.index ?? source.length),
  }));
}

const actions = actionFiles.flatMap(actionsOf);

describe('server actions: who may call them', () => {
  it('finds the action files (so the audit cannot pass by looking at nothing)', () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(8);
    expect(actions.length).toBeGreaterThanOrEqual(40);
  });

  it('exports only async functions from a use-server file', () => {
    for (const file of actionFiles) {
      const exported = [...readFileSync(file, 'utf8').matchAll(/^export (?!async function|type |interface )(\w+)/gm)];
      expect(
        exported.map((m) => m[0]),
        rel(file),
      ).toEqual([]);
    }
  });

  it.each(actions.map((a) => [`${a.file}#${a.name}`, a] as const))('%s is guarded', (id, action) => {
    if (PUBLIC_ACTIONS.has(id)) return;
    const operator = /withOperator\(\s*(\{[^}]*\})/.exec(action.body);
    const self = /\b(withMember|withSession)\(/.test(action.body);
    expect(Boolean(operator) || self, `${id} has no withOperator/withMember/withSession guard`).toBe(true);

    if (self) {
      expect(SELF_SERVICE_ACTIONS.has(action.name), `${action.name} is self-service but not on the list`).toBe(true);
      return;
    }
    const permission = parsePermission(operator![1]!);
    if (isMutating(permission)) {
      expect(roleCan('viewer', permission), `${id} lets a viewer ${JSON.stringify(permission)}`).toBe(false);
      expect(READ_ONLY_ACTIONS.has(action.name), `${action.name} mutates but is listed as read-only`).toBe(false);
    } else {
      expect(READ_ONLY_ACTIONS.has(action.name), `${id} is guarded by ${JSON.stringify(permission)} only`).toBe(true);
    }
  });

  it('keeps the allow-lists honest: every name on them is a real action', () => {
    const names = new Set(actions.map((a) => a.name));
    for (const name of [...READ_ONLY_ACTIONS, ...SELF_SERVICE_ACTIONS]) expect(names.has(name), name).toBe(true);
    for (const id of PUBLIC_ACTIONS)
      expect(
        actions.some((a) => `${a.file}#${a.name}` === id),
        id,
      ).toBe(true);
  });

  it('team actions need the team permissions, which only owners hold', () => {
    const team = new Map(
      actions.filter((a) => a.file === 'app/studio/devices/team-actions.ts').map((a) => [a.name, a]),
    );
    const expected: Record<string, Permission> = {
      inviteMemberAction: { invitation: ['create'] },
      resendInvitationAction: { invitation: ['create'] },
      revokeInvitationAction: { invitation: ['cancel'] },
      changeMemberRoleAction: { member: ['update'] },
      removeMemberAction: { member: ['delete'] },
    };
    for (const [name, permission] of Object.entries(expected)) {
      const body = team.get(name)?.body ?? '';
      const written = /withOperator\(\s*(\{[^}]*\})/.exec(body)?.[1];
      expect(written && parsePermission(written), name).toEqual(permission);
      expect(roleCan('owner', permission), `owner ${name}`).toBe(true);
      expect(roleCan('operator', permission), `operator ${name}`).toBe(false);
      expect(roleCan('viewer', permission), `viewer ${name}`).toBe(false);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// Route handlers under app/api

type RouteKind =
  /** Better Auth's own endpoints; authorization is the organization plugin's `ac` roles. */
  | 'auth'
  /** A signed-in operator, checked with roleCan(). `mutates` routes must name a permission viewers lack. */
  | { operator: { mutates: boolean } }
  /** A booth device's bearer token (`authenticateDevice`). Viewers cannot mint one: device:register. */
  | 'device'
  /** Vercel Cron's bearer secret. */
  | 'cron'
  /** Only when E2E=1 and the run's token is sent. */
  | 'e2e'
  /** Guests and TV screens: a short code, a gallery password or a signed URL, never an operator session. */
  | 'public';

const ROUTES: Record<string, RouteKind> = {
  'app/api/auth/[...all]/route.ts': 'auth',
  'app/api/booth/codes/route.ts': 'device',
  'app/api/booth/outputs/[id]/complete/route.ts': 'device',
  'app/api/booth/sessions/route.ts': 'device',
  'app/api/booth/sessions/[id]/display/route.ts': 'device',
  'app/api/booth/sessions/[id]/email/route.ts': 'device',
  'app/api/cron/expire/route.ts': 'cron',
  'app/api/devices/heartbeat/route.ts': 'device',
  'app/api/events/[id]/files/route.ts': { operator: { mutates: false } },
  'app/api/g/[slug]/files/route.ts': 'public',
  'app/api/g/[slug]/unlock/route.ts': 'public',
  'app/api/integrations/[provider]/callback/route.ts': { operator: { mutates: true } },
  'app/api/integrations/[provider]/connect/route.ts': { operator: { mutates: true } },
  'app/api/live/events/[id]/feed/route.ts': { operator: { mutates: false } },
  'app/api/live/feed/route.ts': 'public',
  'app/api/live/media/[outputId]/route.ts': 'public',
  'app/api/live/pair/route.ts': 'public',
  'app/api/share/[linkId]/route.ts': 'public',
  'app/api/test/expire/route.ts': 'e2e',
  'app/api/test/mailbox/route.ts': 'e2e',
};

const routeFiles = walk(join(SRC, 'app/api'), (f) => /[\\/]route\.ts$/.test(f));

describe('route handlers under app/api: who may call them', () => {
  it('classifies every route (a new route fails here until someone decides who may call it)', () => {
    expect(routeFiles.map(rel).sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it.each(routeFiles.map((f) => [rel(f), readFileSync(f, 'utf8')] as const))('%s checks its caller', (file, source) => {
    const kind = ROUTES[file]!;
    if (kind === 'auth') {
      expect(source).toContain('toNextJsHandler');
    } else if (kind === 'device') {
      expect(source, 'device routes authenticate the bearer token').toMatch(/authenticateDevice\(request\)/);
      expect(source).toMatch(/if \(!device\)/);
    } else if (kind === 'cron') {
      expect(source).toContain('CRON_SECRET');
    } else if (kind === 'e2e') {
      expect(source).toMatch(/if \(!isE2ERequest\(request\)\)/);
    } else if (kind === 'public') {
      // Public routes must not pick up an operator session by accident.
      expect(source).not.toMatch(/getOperator|requireOperator/);
    } else {
      expect(source).toMatch(/getOperator\(\)/);
      const checks = [...source.matchAll(/roleCan\(op\.role,\s*(\{[^}]*\})\)/g)].map((m) => parsePermission(m[1]!));
      expect(checks.length, `${file} must check a permission`).toBeGreaterThan(0);
      for (const permission of checks) {
        if (kind.operator.mutates) {
          expect(isMutating(permission), `${file} guards a mutation with a read permission`).toBe(true);
          expect(roleCan('viewer', permission), `${file} lets a viewer ${JSON.stringify(permission)}`).toBe(false);
        } else {
          expect(isMutating(permission), `${file} is read-only but asks for ${JSON.stringify(permission)}`).toBe(false);
        }
      }
    }
  });
});
