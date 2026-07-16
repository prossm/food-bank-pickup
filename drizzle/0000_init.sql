-- Food bank pickup scheduler — initial schema.
--
-- Vocabulary that this schema enforces and the rest of the code must respect:
--   a SPOT is one pickup, i.e. one car. Never a person, never a family.
--   an ambassador collecting for 5 families occupies 1 spot and 5 rows in pickup_families.
-- slots.capacity and slots.booked_count count cars. Conflating them with people is
-- the central bug this domain invites, so the two numbers are never derived from each other.

CREATE TYPE locale       AS ENUM ('en', 'es', 'zh');
CREATE TYPE pickup_role  AS ENUM ('ambassador', 'family');
CREATE TYPE allergy_kind AS ENUM ('gluten_free', 'dairy_free');
CREATE TYPE notif_kind   AS ENUM ('confirmation', 'reminder');

-- Whoever is on the other end of the conversation.
-- Keyed by (channel, external_id) rather than phone: the web sim has no phone number,
-- and SMS has nothing but one. Keying on phone alone would force a migration at Twilio time.
CREATE TABLE contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel      text NOT NULL CHECK (channel IN ('web', 'sms', 'whatsapp')),
  external_id  text NOT NULL,
  phone_e164   text,
  display_name text,
  locale       locale NOT NULL DEFAULT 'en',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);

CREATE TABLE slots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at    timestamptz NOT NULL UNIQUE,
  capacity     int NOT NULL CHECK (capacity >= 0),
  booked_count int NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- Backstop. The claim CTE in repos/pickups.ts is the only writer and already guards this,
  -- but if a future code path ever increments carelessly the database refuses rather than
  -- quietly overselling a slot and sending 31 people to a 30-car pickup.
  CONSTRAINT slots_not_oversold CHECK (booked_count >= 0 AND booked_count <= capacity)
);

CREATE TABLE pickups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id           uuid NOT NULL REFERENCES slots(id),
  contact_id        uuid NOT NULL REFERENCES contacts(id),
  role              pickup_role NOT NULL,
  status            text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
  confirmation_code text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz
);

-- Partial, so that cancelling and re-booking the same slot stays legal while an impatient
-- double-tap surfaces as a 23505 the booking path maps to "you're already signed up".
CREATE UNIQUE INDEX pickups_one_active_per_contact_slot
  ON pickups (slot_id, contact_id) WHERE status = 'booked';

CREATE INDEX pickups_slot_booked ON pickups (slot_id) WHERE status = 'booked';

-- Families are first-class and outlive any single week's pickup.
CREATE TABLE families (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  -- Deliberately NOT unique: an ambassador's five families each have their own number,
  -- and two households can legitimately share a phone.
  phone_e164            text,
  family_size           int NOT NULL CHECK (family_size >= 1 AND family_size <= 30),
  created_by_contact_id uuid REFERENCES contacts(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Rows rather than boolean columns, so adding nut_free later is an enum value, not a migration
-- of every consumer.
CREATE TABLE family_allergies (
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  kind      allergy_kind NOT NULL,
  PRIMARY KEY (family_id, kind)
);

-- The join that makes the ambassador math work: N families : 1 pickup : 1 spot.
CREATE TABLE pickup_families (
  pickup_id            uuid NOT NULL REFERENCES pickups(id) ON DELETE CASCADE,
  family_id            uuid NOT NULL REFERENCES families(id),
  position             int  NOT NULL,
  -- Snapshots. A family editing its size next month must not silently rewrite what was
  -- staged for a pickup that already happened.
  family_size_snapshot int  NOT NULL CHECK (family_size_snapshot >= 1),
  food_tier_snapshot   text NOT NULL,
  PRIMARY KEY (pickup_id, family_id),
  UNIQUE (pickup_id, position)
);

-- Tiers are DATA, not code. The real boundaries are unconfirmed with the food bank
-- (the brief says "3-4" and "6+", which defines neither 5 nor 1-2), so they must be
-- editable without a deploy.
CREATE TABLE food_tiers (
  id        text PRIMARY KEY,
  min_size  int  NOT NULL CHECK (min_size >= 1),
  max_size  int,                                   -- NULL means unbounded, i.e. "6+"
  boxes     int  NOT NULL CHECK (boxes >= 1),
  label_key text NOT NULL,
  CONSTRAINT tiers_sane_bounds CHECK (max_size IS NULL OR max_size >= min_size),
  -- Overlapping tiers would make food amount depend on row order. The database refuses.
  -- (Gaps are caught by the tiers test, which the DB can't express.)
  CONSTRAINT tiers_no_overlap EXCLUDE USING gist (
    int4range(min_size, CASE WHEN max_size IS NULL THEN NULL ELSE max_size + 1 END, '[)') WITH &&
  )
);

-- Serverless keeps no state between requests, so the entire conversation lives here.
CREATE TABLE conversation_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel     text NOT NULL,
  external_id text NOT NULL,
  contact_id  uuid REFERENCES contacts(id),
  state       jsonb NOT NULL,
  version     int NOT NULL DEFAULT 0,   -- optimistic lock; guards against double-send interleaving
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);

CREATE TABLE messages (
  id         bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  direction  text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body       text NOT NULL,
  -- Render order comes from seq, never created_at: two messages inserted in the same
  -- millisecond would otherwise render in arbitrary order.
  seq        int  NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);

CREATE TABLE notifications (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_id uuid NOT NULL REFERENCES pickups(id) ON DELETE CASCADE,
  kind      notif_kind NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  -- Makes a re-run of the (future) reminder sweep a no-op instead of a second text.
  UNIQUE (pickup_id, kind)
);

-- The two numbers staff care about, named apart so nothing has to guess which is which:
-- spots_left answers "can I sign up", people_served answers "how much food do we stage".
CREATE VIEW slot_load AS
SELECT
  s.id,
  s.starts_at,
  s.capacity,
  s.status,
  s.booked_count                              AS spots_used,
  s.capacity - s.booked_count                 AS spots_left,
  COUNT(pf.family_id)                         AS families_served,
  COALESCE(SUM(pf.family_size_snapshot), 0)   AS people_served
FROM slots s
LEFT JOIN pickups p          ON p.slot_id = s.id AND p.status = 'booked'
LEFT JOIN pickup_families pf ON pf.pickup_id = p.id
GROUP BY s.id;
