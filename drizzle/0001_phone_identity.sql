-- Phone number becomes a household's identity, replacing name.
--
-- Why: an ambassador delivering to five families knows their phone numbers, not their
-- surnames. Names are the admin's job now, so the chat stops asking for them and dedupes on
-- phone instead — the same household signing up week after week is one row, not fifty.
--
-- Once this runs over SMS/WhatsApp a phone number is guaranteed: it arrives with every
-- message. The web simulation asks for it explicitly.

-- Names are supplied by staff later, so the chat inserts households without one.
-- (The length CHECK is left in place: it passes on NULL and still bounds real names.)
ALTER TABLE families ALTER COLUMN name DROP NOT NULL;

-- The identity. Partial rather than a plain NOT NULL + UNIQUE, for two reasons:
--   1. Rows already exist whose phone is NULL (created when phone was skippable), and a
--      blind NOT NULL would either fail this migration or require deleting real rows.
--      Multiple NULLs don't conflict under a partial index, so they survive untouched and
--      staff can reconcile them.
--   2. It keeps the door open for a household with genuinely no phone, which the flow
--      forbids today but a future intake path might not.
-- The conversation enforces that a phone is present; this enforces that it's unique.
CREATE UNIQUE INDEX families_phone_identity
  ON families (phone_e164) WHERE phone_e164 IS NOT NULL;

-- When the household's size was last actually confirmed by a human.
--
-- A known phone now silently reuses the stored size and skips the questions, which keeps the
-- thread short but means a size can quietly go stale for years — and a stale size means the
-- wrong amount of food, with nothing to signal it. This column doesn't fix that; it makes it
-- visible on the roster so staff can spot what needs re-checking.
ALTER TABLE families ADD COLUMN IF NOT EXISTS size_confirmed_at timestamptz;
UPDATE families SET size_confirmed_at = created_at WHERE size_confirmed_at IS NULL;
