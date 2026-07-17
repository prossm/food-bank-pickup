import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_COOKIE, LOGIN_PATH } from '@/lib/auth/cookie';

/**
 * An optimistic pre-filter for /admin. NOT the security boundary — requireAdmin() in
 * src/lib/auth/dal.ts is.
 *
 * All this can prove is that *some* fb_admin cookie is present, which anyone can arrange with
 * one line in a console; the token is only validated against the database in the DAL, which
 * runs before any household data is read. What this does buy is that an /admin route added
 * later, whose author forgets requireAdmin(), still fails closed for anyone not carrying a
 * session at all.
 *
 * The check is deliberately cookie-only. Next runs proxy on the Node.js runtime as of 16, so
 * a database query here would work — but proxy runs on every matched request including
 * prefetches, and the docs are explicit that it is not the place for session lookups.
 *
 * (Middleware was renamed to Proxy in Next.js 16. Same mechanism, same file position.)
 */
export function proxy(req: NextRequest) {
  // The login page lives under /admin and must stay reachable, or this redirects to itself.
  if (req.nextUrl.pathname === LOGIN_PATH) return NextResponse.next();
  if (req.cookies.has(ADMIN_COOKIE)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  return NextResponse.redirect(url);
}

export const config = {
  // ':path*' matches zero or more segments, so this covers /admin itself as well as below it.
  matcher: ['/admin/:path*'],
};
