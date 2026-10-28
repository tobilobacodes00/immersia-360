import 'server-only';
import { ForbiddenError, getOperator, getSession, type Operator } from './session';
import { roleCan, type Permission } from '@/lib/permissions';

export type ActionError =
  'unauthenticated' | 'forbidden' | 'invalid' | 'not_found' | 'conflict' | 'rate_limited' | 'failed';
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: ActionError; issues?: string[] };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = (error: ActionError, issues?: string[]): ActionResult<never> => ({ ok: false, error, issues });

/**
 * Wrap a server action body with authentication and authorization. Server actions are public HTTP
 * endpoints, so every one re-checks the session and role here — never relying on the UI.
 */
export async function withOperator<T>(
  permission: Permission,
  body: (op: Operator) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const op = await getOperator();
  if (!op) return fail('unauthenticated');
  if (!roleCan(op.role, permission)) return fail('forbidden');
  return guarded(() => body(op));
}

/**
 * For actions every member may take about their own membership, viewers included (leaving the
 * organization). Authenticated, and a member of the active organization; no further permission.
 */
export async function withMember<T>(body: (op: Operator) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const op = await getOperator();
  if (!op) return fail('unauthenticated');
  return guarded(() => body(op));
}

/**
 * For actions any signed-in user may take in their own right, whatever organization they are in:
 * accepting an invitation addressed to them, switching to an organization they belong to. The body
 * still has to check what it touches (Better Auth verifies the invitation's recipient and the
 * user's membership); this only establishes who is asking.
 */
export async function withSession<T>(
  body: (user: { id: string; email: string }) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const session = await getSession();
  if (!session) return fail('unauthenticated');
  return guarded(() => body({ id: session.user.id, email: session.user.email }));
}

async function guarded<T>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ForbiddenError) return fail('forbidden');
    // Next's redirect()/notFound() throw control-flow errors that must propagate.
    if (err && typeof err === 'object' && 'digest' in err) throw err;
    console.error('[action]', err);
    return fail('failed');
  }
}
