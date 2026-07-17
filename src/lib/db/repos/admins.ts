import { createHash, randomBytes } from 'node:crypto';
import { query } from '../client';

export interface AdminUser {
  id: string;
  email: string;
}

interface AdminCredentials extends AdminUser {
  passwordHash: string;
}

/** 256 bits of CSPRNG output — not guessable, so the token needs no stretching. */
const TOKEN_BYTES = 32;

/**
 * A staff session lasts one working day and does not slide. Someone who signs in on a shared
 * terminal at the food bank and walks away is signed out by the next morning without anyone
 * having to remember to do it.
 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Plain SHA-256, deliberately, where passwords get scrypt.
 *
 * The distinction is the input. A password is low-entropy and human-chosen, so a stolen hash
 * is worth guessing at and must be expensive to guess. A session token is 32 random bytes:
 * there is no dictionary and no cracking it, so a slow KDF would buy nothing and cost real
 * latency on every single authenticated request.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export async function findAdminByEmail(email: string): Promise<AdminCredentials | null> {
  const rows = await query<{ id: string; email: string; password_hash: string }>(
    `SELECT id, email, password_hash FROM admin_users WHERE lower(email) = lower($1)`,
    [email],
  );
  const row = rows[0];
  return row ? { id: row.id, email: row.email, passwordHash: row.password_hash } : null;
}

/** Returns the raw token for the cookie. Only its hash is stored. */
export async function createAdminSession(adminUserId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await query(`INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    adminUserId,
    hashToken(token),
    expiresAt,
  ]);

  // Expired rows are already ignored by adminForSessionToken, so this is housekeeping rather
  // than a security control — it just keeps the table from growing forever. Login is a rare
  // event and the table is tiny, so it needs no schedule of its own.
  await query(`DELETE FROM admin_sessions WHERE expires_at <= now()`);

  return { token, expiresAt };
}

export async function adminForSessionToken(token: string): Promise<AdminUser | null> {
  const rows = await query<{ id: string; email: string }>(
    `SELECT u.id, u.email
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function deleteAdminSession(token: string): Promise<void> {
  await query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [hashToken(token)]);
}

export async function touchAdminLastLogin(adminUserId: string): Promise<void> {
  await query(`UPDATE admin_users SET last_login_at = now() WHERE id = $1`, [adminUserId]);
}
