/**
 * Password hashing for staff accounts, on node:crypto's scrypt.
 *
 * scrypt rather than bcrypt/argon2 because it is memory-hard, is in the standard library, and
 * therefore adds no native dependency to a build that has to work on Vercel. It is also the
 * only credible option already installed.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

/**
 * ~87ms per hash on a 2024 laptop — slow enough to make offline cracking of a stolen hash
 * expensive, fast enough that a staff login doesn't feel broken.
 *
 * These are the parameters used for NEW hashes only. Verification reads whatever parameters
 * are recorded in the stored string, so raising the cost here does not invalidate existing
 * passwords: old hashes keep verifying at their old cost until each is next set.
 */
interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

const PARAMS: ScryptParams = { N: 32_768, r: 8, p: 1 };
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/**
 * scrypt needs roughly 128 * N * r bytes of memory, which for the parameters above is exactly
 * Node's default maxmem of 32 MiB — and OpenSSL's check has enough overhead on top that the
 * call throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS rather than landing on the boundary. So maxmem
 * has to be raised explicitly, or every hash fails. Headroom for a future cost increase.
 */
const MAXMEM = 96 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, keylen: number, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Note: scrypt throws synchronously on bad params rather than passing an error to the
    // callback. Inside the executor that still rejects, which is what we want either way.
    scryptCb(password, salt, keylen, { ...params, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/**
 * Two visually identical passwords can be different byte sequences (an accented character
 * composed one way on macOS and another on Windows). Normalising means the password typed at
 * the curb matches the one typed when the account was made.
 */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

/** `scrypt$N$r$p$salt$key`, all parameters inline so verification never has to guess them. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(normalize(password), salt, KEY_BYTES, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Object.values(params).every((v) => Number.isInteger(v) && v > 0)) return false;

  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(keyB64, 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scrypt(normalize(password), salt, expected.length, params);
  } catch {
    // Params recorded in the row are unusable on this machine (e.g. a future hash whose
    // memory cost exceeds MAXMEM). Not a match, and not a reason to 500 the login form.
    return false;
  }

  // timingSafeEqual, not ===, so the comparison doesn't leak how much of the hash matched.
  // It throws on a length mismatch, which the scrypt keylen above already rules out.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Spends the same scrypt work as verifyPassword, with nothing to compare against.
 *
 * Called when the submitted email matches no account. Without it, an unknown address returns
 * in ~0ms and a known one takes ~87ms, which turns the login form into an oracle for which
 * staff addresses are real — worth denying on its own, and worth more here because those
 * addresses are the accounts an attacker would then go after.
 */
export async function equalizeVerifyTiming(password: string): Promise<void> {
  await hashPassword(password);
}
