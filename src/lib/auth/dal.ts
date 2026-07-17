import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminForSessionToken, type AdminUser } from '@/lib/db/repos/admins';
import { ADMIN_COOKIE, LOGIN_PATH } from './cookie';

/**
 * The security boundary for /admin. Everything that reads household data must call this
 * first.
 *
 * This is checked here, against the database, and not in proxy.ts — the proxy sees only
 * whether a cookie is present, which anyone can arrange. Keeping the real check next to the
 * data means a new admin page or Server Action is protected by the act of loading its data,
 * rather than by whoever adds it remembering to update a list of protected routes.
 *
 * cache() memoises this for one render pass, so a page that calls it in several places still
 * makes one query.
 */
export const requireAdmin = cache(async (): Promise<AdminUser> => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  const admin = token ? await adminForSessionToken(token) : null;
  if (!admin) redirect(LOGIN_PATH);
  return admin;
});

/** Same lookup without the redirect, for deciding what to show a signed-out visitor. */
export const currentAdmin = cache(async (): Promise<AdminUser | null> => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return token ? adminForSessionToken(token) : null;
});
