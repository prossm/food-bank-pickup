/**
 * Prints the SQL that creates a staff account, or resets an existing one's password.
 *
 *   npm run admin:sql -- pat@foodbank.org              # prompts for a password
 *   npm run admin:sql -- pat@foodbank.org --generate   # mints a strong one and prints it
 *
 * Paste the output into the Neon SQL editor (or psql, locally).
 *
 * This script never connects to a database, and deliberately so. Bootstrapping the first
 * admin is the one operation that cannot be done from behind the login, and the two obvious
 * alternatives are both worse: a "create first admin" HTTP endpoint is a public account-
 * creation hole that has to be remembered and removed, and a script that writes to production
 * needs the production credential on a laptop. Hashing locally and pasting one statement into
 * the console needs neither — the password never leaves this machine, and the credential
 * never leaves Neon.
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { hashPassword } from '../src/lib/auth/password';

/** ~24 base64url characters, i.e. 144 bits. Well past anything worth guessing at. */
const GENERATED_BYTES = 18;

/**
 * Short passwords are the only real threat to this table: scrypt makes cracking expensive
 * per guess, but nothing rescues an 8-character password from a determined attacker with the
 * hash. Length is the defence, so require some. --generate sidesteps the question entirely.
 */
const MIN_LENGTH = 12;

function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress the echo so the password isn't left on screen (or in a screen-share). readline
    // has no supported way to do this, hence the internal hook; the newline still gets through
    // so the prompts don't run together.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
      if (s.includes('\n')) process.stdout.write('\n');
    };
    process.stdout.write(question);
    rl.question('', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Postgres string literal escaping. The email is the only value here from outside. */
function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function main() {
  const args = process.argv.slice(2);
  const generate = args.includes('--generate');
  const email = args.find((a) => !a.startsWith('--'));

  if (!email) fail('usage: npm run admin:sql -- <email> [--generate]');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`"${email}" doesn't look like an email address`);

  let password: string;
  if (generate) {
    password = randomBytes(GENERATED_BYTES).toString('base64url');
  } else {
    password = await promptHidden(`Password for ${email}: `);
    const confirm = await promptHidden('Confirm password: ');
    if (password !== confirm) fail('passwords do not match');
    if (password.length < MIN_LENGTH) fail(`use at least ${MIN_LENGTH} characters`);
  }

  const hash = await hashPassword(password);

  // ON CONFLICT infers the unique index on lower(email), so this doubles as password reset:
  // running it again for an existing address replaces the hash rather than erroring.
  const sql =
    `INSERT INTO admin_users (email, password_hash)\n` +
    `VALUES (${sqlLiteral(email)}, ${sqlLiteral(hash)})\n` +
    `ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash;`;

  console.log(`\n-- Run this in the Neon SQL editor (production) or psql (local).`);
  console.log(`-- Creates ${email}, or resets its password if it already exists.\n`);
  console.log(sql);

  if (generate) {
    console.log(`\nGenerated password for ${email}:\n\n    ${password}\n`);
    console.log('This is not stored anywhere and cannot be recovered — put it in a password');
    console.log('manager now. Re-run with --generate to issue a new one.');
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
