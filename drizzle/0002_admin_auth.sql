-- Authentication for the staff roster at /admin.
--
-- Until now /admin was a public URL that rendered every household's phone number, size,
-- dietary restrictions and confirmation code. The rows were test data, so nothing leaked —
-- but the route was the liability, not the rows, and this is what closes it.

CREATE TABLE IF NOT EXISTS admin_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CONSTRAINT admin_users_email_check CHECK (length(email) BETWEEN 3 AND 254)
);

-- Identity is the address case-folded: staff will type Pat@ and pat@ on different days and
-- must land on one account. Enforcing it here rather than trusting every caller to lowercase
-- first means a second account that differs only in case cannot exist at all.
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_key ON admin_users (lower(email));

CREATE TABLE IF NOT EXISTS admin_sessions (
  -- ON DELETE CASCADE: removing a staff member has to revoke their live sessions too,
  -- otherwise "delete the account" leaves whoever holds the cookie still signed in.
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  -- The SHA-256 of the cookie value, never the value itself. A session token is a bearer
  -- credential: anyone holding it is logged in. Storing it verbatim would mean a database
  -- dump, a backup, or one careless SELECT in a SQL console hands over live sessions to
  -- whoever reads the output. Hashed, the rows are inert — the cookie cannot be
  -- reconstructed from them.
  token_hash    text PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

-- Supports the expired-session sweep on login. Lookups go through the primary key.
CREATE INDEX IF NOT EXISTS admin_sessions_expires_at ON admin_sessions (expires_at);
