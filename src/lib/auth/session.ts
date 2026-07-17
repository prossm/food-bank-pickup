import { cookies } from 'next/headers';
import { createAdminSession, deleteAdminSession } from '@/lib/db/repos/admins';
import { ADMIN_COOKIE, ADMIN_COOKIE_PATH } from './cookie';

/**
 * Cookies can only be written from a Server Function or Route Handler — never during a page
 * render, because HTTP won't take a Set-Cookie once the response has started streaming. Both
 * functions here are called from Server Actions for that reason.
 */
function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    // Off on localhost, which is http — a Secure cookie there is set and never sent back,
    // so login would appear to succeed and then silently fail to stick.
    secure: process.env.NODE_ENV === 'production',
    // 'lax' keeps the cookie off cross-site requests while still surviving a normal
    // top-level navigation into /admin from a bookmark or a link.
    sameSite: 'lax' as const,
    path: ADMIN_COOKIE_PATH,
    expires,
  };
}

export async function startAdminSession(adminUserId: string): Promise<void> {
  const { token, expiresAt } = await createAdminSession(adminUserId);
  (await cookies()).set(ADMIN_COOKIE, token, cookieOptions(expiresAt));
}

export async function endAdminSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;

  // Delete the row first: that is what actually ends the session. Clearing the cookie only
  // tidies up this one browser, and a signed-out token that still validated server-side
  // would be the whole bug.
  if (token) await deleteAdminSession(token);

  // Overwrite rather than .delete(name), which defaults to path '/' and would leave a cookie
  // set at /admin untouched.
  store.set(ADMIN_COOKIE, '', { ...cookieOptions(new Date(0)), maxAge: 0 });
}
