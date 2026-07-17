import { z } from 'zod';
import type { SessionState } from './types';
import { initialState } from './types';

const allergySchema = z.enum(['gluten_free', 'dairy_free']);

const familySchema = z.object({
  phone: z.string(),
  size: z.number().int(),
  allergies: z.array(allergySchema),
  isSelf: z.boolean().optional(),
  known: z.boolean().optional(),
});

export const sessionStateSchema = z.object({
  // v1 sessions (household names, optional phone, a FAMILY_NAME node) fail this literal and
  // are reset rather than fed to a machine that no longer has those states. Anyone mid-flow
  // across the deploy starts over — which is the intended trade, and why the reset is polite.
  v: z.literal(2),
  node: z.enum([
    'LANG_SELECT', 'ROLE_SELECT', 'AMBASSADOR_OWN_HOUSEHOLD', 'FAMILY_COUNT',
    'FAMILY_PHONE', 'FAMILY_SIZE', 'FAMILY_ALLERGIES',
    'SLOT_SELECT', 'CONFIRM', 'DONE',
  ]),
  locale: z.enum(['en', 'es', 'zh']),
  role: z.enum(['ambassador', 'family']).nullable(),
  includeSelf: z.boolean(),
  familyCount: z.number().int().nullable(),
  cursor: z.number().int(),
  families: z.array(familySchema),
  partial: z.object({
    phone: z.string().optional(),
    size: z.number().int().optional(),
    allergies: z.array(allergySchema).optional(),
  }),
  selectedSlotId: z.string().nullable(),
  confirmation: z.object({ code: z.string(), slotStartsAt: z.string() }).nullable(),
});

/**
 * Reads persisted state, falling back to a fresh conversation if the shape has drifted.
 *
 * Someone is always mid-flow when a new version deploys, and their stored jsonb may no
 * longer match the machine. Resetting them politely is bad; crashing with a 500 on every
 * message until they clear a cookie is worse.
 */
export function parseSessionState(raw: unknown): { state: SessionState; reset: boolean } {
  const result = sessionStateSchema.safeParse(raw);
  if (result.success) return { state: result.data as SessionState, reset: false };
  return { state: initialState(), reset: true };
}
