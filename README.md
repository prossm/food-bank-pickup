# Food Bank Pickup Scheduler — v1

Sign up for a weekly food pickup by text message. Pickups are Wednesdays at 5:00pm and 5:30pm,
30 spots each.

v1 **simulates** the SMS thread as a web chat so the flow can be tested without a phone bill.
The conversation logic is deliberately transport-agnostic: adding Twilio means adding one
route and one transport file, with no changes to the conversation itself.

## The one idea to keep straight

**A spot is one pickup — one car. Never a person, never a family.**

An ambassador collecting for five families takes **one** spot and **five** families' worth of
food. Capacity and food volume are different numbers and are never derived from each other.
The `slot_load` view exposes them as separately named columns (`spots_used` vs `people_served`)
specifically so nothing has to guess.

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

## Open questions for the food bank

1. **Food tier boundaries.** The brief says "3-4 members" and "6+", which defines neither **5**
   nor **1-2**. Seeded as a placeholder: `1-2 → 1 box`, `3-5 → 2 boxes`, `6+ → 3 boxes`. These
   live in the `food_tiers` table, so correcting them is an `UPDATE`, not a deploy. A no-overlap
   constraint and a test covering sizes 1–20 keep gaps from appearing silently.
2. **Cap on families per ambassador?** Currently 10 (`MAX_FAMILIES_PER_AMBASSADOR`).
3. **Do we collect each family's phone on ambassador pickups?** Consent implications once real
   SMS is live.
4. **Waitlist when a slot is full**, or just offer the other time?
5. The help message contains a **placeholder phone number** — needs the real one.

## Not in v1

Mandarin (the catalog is typed and ready — `zh` is one file), reminder cron, cancellation flow
(the decrement SQL exists and is tested; it just isn't wired to the conversation), no-show
tracking, and real Twilio.

**`/admin` has no auth and is currently public.** That must be fixed before this holds real
names and phone numbers.
