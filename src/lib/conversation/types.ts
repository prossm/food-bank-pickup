import type { AllergyKind, FamilyDraft, Locale, PickupRole } from '@/lib/domain/types';
import type { MessageSpec } from '@/lib/i18n/types';

export type Node =
  | 'LANG_SELECT'
  | 'ROLE_SELECT'
  | 'AMBASSADOR_OWN_HOUSEHOLD'
  | 'FAMILY_COUNT'
  | 'FAMILY_NAME'
  | 'FAMILY_PHONE'
  | 'FAMILY_SIZE'
  | 'FAMILY_ALLERGIES'
  | 'SLOT_SELECT'
  | 'CONFIRM'
  | 'DONE';

/** What the parser produces. The state machine never sees raw text. */
export type Intent =
  | { kind: 'select'; value: string }
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'skip' }
  | { kind: 'back' }
  | { kind: 'restart' }
  | { kind: 'help' }
  | { kind: 'unknown'; raw: string };

export interface Option {
  value: string;
  /** Normalized keywords across every active locale. */
  keys: string[];
}

export interface ParseContext {
  text: string;
  node: Node;
  locale: Locale;
  options: Option[];
}

/**
 * The seam an LLM parser drops into later: same interface, same Intent output, and the
 * machine is none the wiser. v1 ships the keyword implementation.
 */
export interface IntentParser {
  parse(ctx: ParseContext): Promise<Intent>;
}

export interface SessionState {
  /** Bumped when the shape changes; old sessions mid-flow are reset rather than crashed. */
  v: 1;
  node: Node;
  locale: Locale;
  role: PickupRole | null;
  includeSelf: boolean;
  familyCount: number | null;
  cursor: number;
  families: FamilyDraft[];
  partial: { name?: string; phone?: string | null; size?: number; allergies?: AllergyKind[] };
  selectedSlotId: string | null;
  confirmation: { code: string; slotStartsAt: string } | null;
}

/** A request for the runner to do I/O. The machine only describes it. */
export type Effect = { type: 'BOOK'; slotId: string };

export type EffectResult =
  | { kind: 'booked'; code: string; slotStartsAt: string; families: number; boxes: number }
  | { kind: 'slot_full' }
  | { kind: 'already_booked' };

export type Event =
  | { type: 'intent'; intent: Intent }
  | { type: 'effectResult'; result: EffectResult }
  | { type: 'start' };

export interface TransitionContext {
  slots: import('@/lib/domain/types').SlotView[];
  tiers: import('@/lib/domain/types').FoodTier[];
}

export interface TransitionOutput {
  state: SessionState;
  effects: Effect[];
  out: MessageSpec[];
}

export const MAX_FAMILIES_PER_AMBASSADOR = 10;
export const MAX_HOUSEHOLD_SIZE = 30;
export const MAX_NAME_LENGTH = 120;

export function initialState(): SessionState {
  return {
    v: 1,
    node: 'LANG_SELECT',
    locale: 'en',
    role: null,
    includeSelf: false,
    familyCount: null,
    cursor: 0,
    families: [],
    partial: {},
    selectedSlotId: null,
    confirmation: null,
  };
}
