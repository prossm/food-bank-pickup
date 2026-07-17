# Food Bank Pickup Scheduler — v1 

Sign up for a weekly food pickup by text message. Pickups are Wednesdays at 5:00pm and 5:30pm,
30 spots each.

v1 **simulates** the SMS thread as a web chat so the flow can be tested without a phone bill.
The conversation logic is deliberately transport-agnostic: adding Twilio means adding one
route and one transport file, with no changes to the conversation itself.

## Two ideas to keep straight

**1. A spot is one pickup — one car. Never a person, never a family.**

An ambassador collecting for five families takes **one** spot and **five** families' worth of
food. Capacity and food volume are different numbers and are never derived from each other.
The `slot_load` view exposes them as separately named columns (`spots_used` vs `people_served`)
specifically so nothing has to guess.

**2. A household is its phone number, not its name.**

An ambassador knows the numbers of the people they deliver to, not their surnames — so the
chat never asks for a name, and dedupes on phone instead. The same household signing up week
after week is one row, not fifty. Names are entered by **staff**, and `upsertFamilyByPhone`
must never write that column.

A known number **silently reuses** its stored size and restrictions and skips both questions,
which takes an ambassador's thread from six answers to two. The cost is that a size can go
stale with no way to correct it from the chat, so `families.size_confirmed_at` records when a
human last confirmed it and `/admin` flags anything older than 180 days.

## Running it locally

```bash
createdb foodbank
cp .env.example .env          # defaults point at a local Postgres
npm install
npm run migrate
npm run seed
npm run dev                   # http://localhost:3000
```

- `/chat` — the simulated text thread
- `/admin` — staff roster: spots left, households, people, boxes to stage

## Staff accounts for /admin

The roster shows every household's phone number, size and dietary restrictions, so it sits
behind a login. There is no sign-up page — creating the first account is the one thing that
can't be done from behind the login, and an open "create admin" endpoint would be a hole in
its own right. Instead, hash the password locally and run one statement:

```bash
npm run admin:sql -- pat@foodbank.org              # prompts for a password
npm run admin:sql -- pat@foodbank.org --generate   # mints a strong one and prints it
```

It prints an `INSERT ... ON CONFLICT DO UPDATE`. Paste it into psql locally, or the **Neon SQL
editor** for production. The script never connects to a database: the password stays on your
machine and the production credential stays in Neon. Re-running it for an existing address
resets that password, which is also how a password reset works today.

Sessions live in `admin_sessions` and last 12 hours. To revoke one immediately —
`DELETE FROM admin_sessions WHERE admin_user_id = ...` — or all of them, `TRUNCATE
admin_sessions`. Deleting an account revokes its sessions by cascade.

The security boundary is `requireAdmin()` in `src/lib/auth/dal.ts`, which every admin page and
action must call before reading household data. `src/proxy.ts` also redirects cookie-less
requests, but that is only a pre-filter — it checks that *a* cookie exists, not that it's
valid, so it is not something to rely on. (Middleware is called Proxy as of Next.js 16.)

Known gaps, accepted for now: no login rate limiting, no MFA, no self-service reset. See
"Open questions" before this meets real staff.

## Migrations — they run themselves on deploy

**Every Vercel deploy runs `migrate` then `seed` before `next build`**, via the `vercel-build`
script in package.json. There is no manual step and nothing to remember. Deploying applies any
new migration; that is the only way schema reaches production.

**Why it works this way.** Neon's Vercel integration creates `DATABASE_URL` as a *sensitive*
variable, which Vercel will let you write but never read back — `vercel env pull` returns an
empty string for it. So the production database is unreachable from a developer machine, and
migrations have to run somewhere that already holds the credential. The build does. The secret
never leaves Vercel, which is a better outcome than copying it onto laptops.

**Adding a migration:** drop a new `drizzle/NNNN_name.sql` in sequence. Applied files are
tracked in the `_migrations` table and skipped on later runs. Nothing else to do — the next
deploy picks it up.

**What makes re-running safe on every deploy:**
- Applied migrations are recorded in `_migrations` and skipped (`skip 0000_init.sql` in the log).
- Each migration runs inside a transaction — a failure rolls back and **fails the build**,
  rather than half-applying and deploying anyway.
- `migrate` takes a **Postgres advisory lock**. Two deploys can build concurrently; without it
  both would apply the same file and one would fail the deploy on a duplicate object.
- `seed` uses `ON CONFLICT DO NOTHING` **everywhere**, food tiers included. It fills in what's
  absent and never owns a value. This matters: `DO UPDATE` there would silently revert the food
  bank's corrected tier boundaries to the placeholders on every single deploy.
- Seeding slots each deploy is deliberate — it rolls the Wednesday slots forward six weeks, and
  existing ones are left alone (`ON CONFLICT (starts_at) DO NOTHING`). With no reminder cron
  yet, this is what keeps future slots available.

**Reading the deploy log** — a healthy build says:

```
skip 0000_init.sql
applied 0001_phone_identity.sql
tiers already present — left untouched
0 slots seeded (America/New_York, capacity 30)
```

`tiers already present` is the good outcome: it means live tier config survived the deploy.

**The tradeoff, stated plainly.** Schema changes ship the moment the deploy does, with no human
gate in between. A destructive migration would apply itself before anyone saw it. Keep
migrations additive and expand-then-contract; anything that drops or rewrites data deserves a
manual run against Neon instead.

### Tests

```bash
createdb foodbank_test
npm test
```

The suite runs against a **real Postgres** (`.env.test`), never a mock. That's deliberate:
the booking race depends on Postgres snapshot semantics, and a mock would happily pass the
broken implementation too.

## Architecture

Three boundaries, enforced by module structure:

| Boundary | Why |
|---|---|
| **Transport ⟷ Runner** | Web chat now, Twilio later. Transport only maps wire format to `InboundMessage`. |
| **Parser ⟷ Machine** | The machine never sees raw text, only an `Intent`. This is where an LLM parser drops in. |
| **Machine ⟷ Effects** | `transition()` is a **pure function**. It describes side effects; the runner performs them. |

> **Review rule:** `lib/conversation/machine.ts` must never import from `lib/db` or
> `lib/transport`. If it does, the Twilio port stops being cheap and the fast tests stop being
> possible.

```
src/lib/
├── conversation/
│   ├── machine.ts        # transition() — pure. no db, no clock, no network
│   ├── runner.ts         # the only place conversation code does I/O
│   ├── nodes.ts          # per-node input spec + keyword tables
│   └── parser/           # keyword-parser.ts implements IntentParser
├── transport/            # twilio-transport.ts lands here
├── i18n/catalog/{en,es}.ts   # missing string = COMPILE error
├── db/repos/             # pickups.ts holds the claim CTE
└── domain/               # food tiers, phone, types
```

## Concurrency: how 30 stays 30

The capacity guard lives **inside** the `UPDATE` (`src/lib/db/repos/pickups.ts`):

```sql
WITH claim AS (
  UPDATE slots SET booked_count = booked_count + 1
   WHERE id = $1 AND status = 'open' AND booked_count < capacity
  RETURNING id
)
INSERT INTO pickups (...) SELECT id, ... FROM claim RETURNING id;
```

Under READ COMMITTED the `UPDATE` takes a row lock; the loser blocks, then re-evaluates its
`WHERE` against the **newly committed** row rather than a stale snapshot. Racer 31 re-checks
`30 < 30`, updates zero rows, and the dependent INSERT inserts nothing. Zero rows returned
means "slot full" — an expected outcome, not an error.

`SELECT count(*)` followed by `INSERT` is **broken** here (both racers read 29 from the same
snapshot), and so is pushing the count into an `INSERT ... SELECT WHERE (SELECT count(*))`
subquery — it looks atomic and isn't. `slots_not_oversold` is the backstop if anyone tries.

The displayed "spots left" is an unlocked read and is **stale by design**. Nothing may gate an
insert on it; the machine has a `slot_full → SLOT_SELECT` edge for losing the race.

## Dependencies

**Do not run `npm audit fix --force` here.** npm's proposed "fix" for the postcss advisory is
to install `next@9.3.3` — a six-year downgrade that would destroy the app. `npm audit` is
clean as of now, and it got that way deliberately:

- **`overrides: { postcss: ^8.5.19 }`** in package.json. Next pins `postcss@8.4.31`, which is
  below the patched 8.5.10, and `next@16.2.10` is the latest published version — so there is
  no upgrade to take. The override forces the patched postcss within the same major. Verified:
  the build compiles all Tailwind classes, dark mode, and keyframes. Once Next ships a release
  bundling postcss ≥8.5.10, drop the override.
- **Drizzle was removed.** The original plan called for it, but every migration is plain SQL —
  the claim CTE, the partial unique index, and the `EXCLUDE` constraint aren't things an ORM
  expresses — so `drizzle-orm`/`drizzle-kit` were never imported and only contributed a
  vulnerable esbuild chain. The `drizzle/` directory is just where the `.sql` files live; the
  name is vestigial. Postgres is reached through `pg` directly.

## Open questions for the food bank

1. **Food tier boundaries.** The brief says "3-4 members" and "6+", which defines neither **5**
   nor **1-2**. Seeded as a placeholder: `1-2 → 1 box`, `3-5 → 2 boxes`, `6+ → 3 boxes`. These
   live in the `food_tiers` table, so correcting them is an `UPDATE`, not a deploy. A no-overlap
   constraint and a test covering sizes 1–20 keep gaps from appearing silently.
2. **Cap on families per ambassador?** Currently 10 (`MAX_FAMILIES_PER_AMBASSADOR`).
3. **Waitlist when a slot is full**, or just offer the other time?
4. **Two households, one phone** (a shared line, or a carer's number) currently collide into a
   single record, because phone is the identity. Rare, but it would quietly under-feed one of
   them. Needs a decision if it's a real scenario here.
5. **How do staff learn a name?** The chat never asks and the ambassador may not know it.
   Presumably at pickup — worth confirming, since it's the only path into that column.
6. The help message contains a **placeholder phone number** — needs the real one.

## Not in v1 — read this before demoing

Two gaps that matter, in order:

1. **Staff cannot enter household names.** Names are supposed to come from the admin, but
   `/admin` is read-only, so every household reads `unnamed` forever. The column, the roster
   display, and the "never overwrite a staff name" guard are all in place — the editing UI is
   simply not built. This is the next thing to do.
2. **`/admin` has no auth.** It lists phone numbers, household sizes, and dietary needs. It's
   currently reachable by anyone with the URL. Deployment Protection is the only thing in
   front of it today, and turning that off to demo the chat exposes the roster too.

Also absent: Mandarin (the catalog is typed and ready — `zh` is one file), reminder cron,
cancellation flow (the decrement SQL exists and is tested; it just isn't wired to the
conversation), no-show tracking, and real Twilio.
