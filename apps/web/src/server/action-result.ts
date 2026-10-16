import 'server-only';
import { ForbiddenError, getOperator, type Operator } from './session';
import { roleCan, type Permission } from '@/lib/permissions';

export type ActionError = 'unauthenticated' | 'forbidden' | 'invalid' | 'not_found' | 'failed';
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
  try {
    return await body(op);
  } catch (err) {
    if (err instanceof ForbiddenError) return fail('forbidden');
    // Next's redirect()/notFound() throw control-flow errors that must propagate.
    if (err && typeof err === 'object' && 'digest' in err) throw err;
    console.error('[action]', err);
    return fail('failed');
  }
}
