/**
 * Names and paths only — no imports.
 *
 * Kept free of `pg` and `next/headers` on purpose: proxy.ts needs the cookie name, and
 * pulling the database client into the proxy to get it would load a connection pool on every
 * request to every route.
 */
export const ADMIN_COOKIE = 'fb_admin';

/**
 * Scoped to /admin, so the staff session cookie is never sent on the public chat requests
 * that make up ~all of this app's traffic. Set and cleared through the same constant, since
 * a cookie deleted at a different path than it was set at silently survives.
 */
export const ADMIN_COOKIE_PATH = '/admin';

export const LOGIN_PATH = '/admin/login';
export const ADMIN_PATH = '/admin';
