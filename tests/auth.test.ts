import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { query, getPool } from '@/lib/db/client';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import {
  adminForSessionToken,
  createAdminSession,
  deleteAdminSession,
  findAdminByEmail,
} from '@/lib/db/repos/admins';

const PASSWORD = 'correct horse battery staple';

beforeEach(async () => {
  await query(`TRUNCATE admin_sessions, admin_users CASCADE`);
});

afterAll(async () => {
  await getPool().end();
});

async function makeAdmin(email = 'pat@foodbank.org'): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [email, await hashPassword(PASSWORD)],
  );
  return rows[0].id;
}

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('wrong password entirely', hash)).toBe(false);
    // One character off, to prove the comparison isn't doing something like a prefix match.
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
  });

  it('salts, so the same password twice is two different hashes', async () => {
    const [a, b] = [await hashPassword(PASSWORD), await hashPassword(PASSWORD)];
    expect(a).not.toEqual(b);
    // Both still verify — the salt is recoverable from each string.
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword(PASSWORD, b)).toBe(true);
  });

  it('never stores the password itself', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toContain(PASSWORD);
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
  });

  it('returns false rather than throwing on a malformed hash', async () => {
    // A row corrupted by hand shouldn't 500 the login form — it should just not match.
    for (const junk of ['', 'not-a-hash', 'scrypt$1$2$3', 'bcrypt$a$b$c$d$e', 'scrypt$x$y$z$c2E$a2V5']) {
      expect(await verifyPassword(PASSWORD, junk)).toBe(false);
    }
  });

  it('verifies a password whose stored cost differs from the current default', async () => {
    // Proves parameters are read from the row: an old hash keeps working after PARAMS is
    // raised, instead of locking every existing admin out on deploy.
    const cheap = 'scrypt$16384$8$1$' + Buffer.from('sixteenbytesalt!').toString('base64url');
    const { scryptSync } = await import('node:crypto');
    const key = scryptSync(PASSWORD, Buffer.from('sixteenbytesalt!'), 64, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 96 * 1024 * 1024,
    });
    const stored = `${cheap}$${key.toString('base64url')}`;
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword('nope', stored)).toBe(false);
  });
});

describe('admin lookup', () => {
  it('finds an account however the address was capitalised', async () => {
    await makeAdmin('Pat@FoodBank.org');
    for (const typed of ['Pat@FoodBank.org', 'pat@foodbank.org', 'PAT@FOODBANK.ORG']) {
      expect(await findAdminByEmail(typed), typed).not.toBeNull();
    }
  });

  it('refuses a second account differing only in case', async () => {
    await makeAdmin('pat@foodbank.org');
    await expect(makeAdmin('PAT@foodbank.org')).rejects.toMatchObject({ code: '23505' });
  });
});

describe('sessions', () => {
  it('resolves a fresh token to its admin', async () => {
    const id = await makeAdmin();
    const { token } = await createAdminSession(id);
    expect(await adminForSessionToken(token)).toMatchObject({ id, email: 'pat@foodbank.org' });
  });

  it('rejects a token that was never issued', async () => {
    await makeAdmin();
    expect(await adminForSessionToken('made-up-token')).toBeNull();
  });

  it('stores only the hash, so the cookie cannot be read back out of the table', async () => {
    const id = await makeAdmin();
    const { token } = await createAdminSession(id);
    const rows = await query<{ token_hash: string }>(`SELECT token_hash FROM admin_sessions`);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toEqual(token);
  });

  it('rejects an expired token', async () => {
    const id = await makeAdmin();
    const { token } = await createAdminSession(id);
    await query(`UPDATE admin_sessions SET expires_at = now() - interval '1 second'`);
    expect(await adminForSessionToken(token)).toBeNull();
  });

  it('rejects the token after sign-out', async () => {
    const id = await makeAdmin();
    const { token } = await createAdminSession(id);
    await deleteAdminSession(token);
    expect(await adminForSessionToken(token)).toBeNull();
  });

  it('revokes live sessions when the account is deleted', async () => {
    const id = await makeAdmin();
    const { token } = await createAdminSession(id);
    await query(`DELETE FROM admin_users WHERE id = $1`, [id]);
    expect(await adminForSessionToken(token)).toBeNull();
  });

  it('sweeps expired rows on the next login without touching live ones', async () => {
    const id = await makeAdmin();
    const stale = await createAdminSession(id);
    await query(`UPDATE admin_sessions SET expires_at = now() - interval '1 day'`);

    const fresh = await createAdminSession(id);
    const rows = await query<{ count: string }>(`SELECT count(*) FROM admin_sessions`);
    expect(Number(rows[0].count)).toBe(1);
    expect(await adminForSessionToken(fresh.token)).not.toBeNull();
    expect(await adminForSessionToken(stale.token)).toBeNull();
  });
});
