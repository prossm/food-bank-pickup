import type { AllergyKind, FamilyDraft, Locale, PickupRole } from '@/lib/domain/types';
import type { MessageSpec } from '@/lib/i18n/types';
import { tierFor } from '@/lib/domain/food-tiers';
import { isValidPhone, toE164 } from '@/lib/domain/phone';
import {
  MAX_FAMILIES_PER_AMBASSADOR,
  MAX_HOUSEHOLD_SIZE,
  initialState,
  type Event,
  type Node,
  type SessionState,
  type TransitionContext,
  type TransitionOutput,
} from './types';

/**
 * The conversation, as a pure function.
 *
 * IMPORTANT: this module must never import from lib/db or lib/transport. It takes state and
 * an event, returns new state plus *descriptions* of side effects, and the runner does the
 * I/O. That's what keeps the Twilio port to a single new file, and what lets the whole flow
 * be tested without a database or a browser.
 */
export function transition(
  state: SessionState,
  event: Event,
  ctx: TransitionContext,
): TransitionOutput {
  if (event.type === 'start') {
    return { state, effects: [], out: [{ key: 'prompt.lang_select' }] };
  }

  if (event.type === 'effectResult') {
    return handleEffectResult(state, event.result, ctx);
  }

  const { intent } = event;

  if (intent.kind === 'restart') {
    const fresh = initialState();
    return { state: fresh, effects: [], out: [{ key: 'msg.restarted' }, { key: 'prompt.lang_select' }] };
  }

  if (intent.kind === 'help') {
    return { state, effects: [], out: [{ key: 'msg.help' }, promptFor(state, ctx)] };
  }

  if (intent.kind === 'back') {
    const back = stepBack(state);
    return { state: back, effects: [], out: [promptFor(back, ctx)] };
  }

  switch (state.node) {
    case 'LANG_SELECT': {
      if (intent.kind !== 'select') return reprompt(state, ctx);
      const next = { ...state, locale: intent.value as Locale, node: 'ROLE_SELECT' as Node };
      return { state: next, effects: [], out: [promptFor(next, ctx)] };
    }

    case 'ROLE_SELECT': {
      if (intent.kind !== 'select') return reprompt(state, ctx);
      const role = intent.value as PickupRole;
      if (role === 'family') {
        // Picking up for themselves: exactly one household, and it's theirs. Skipping the
        // count question here is the difference between a 6-message and an 8-message thread.
        const next: SessionState = {
          ...state,
          role,
          includeSelf: true,
          familyCount: 1,
          cursor: 0,
          node: 'FAMILY_PHONE',
        };
        return { state: next, effects: [], out: [promptFor(next, ctx)] };
      }
      const next: SessionState = { ...state, role, node: 'AMBASSADOR_OWN_HOUSEHOLD' };
      return { state: next, effects: [], out: [promptFor(next, ctx)] };
    }

    case 'AMBASSADOR_OWN_HOUSEHOLD': {
      if (intent.kind !== 'yes' && intent.kind !== 'no') return reprompt(state, ctx);
      const next: SessionState = {
        ...state,
        includeSelf: intent.kind === 'yes',
        node: 'FAMILY_COUNT',
      };
      return { state: next, effects: [], out: [promptFor(next, ctx)] };
    }

    case 'FAMILY_COUNT': {
      if (intent.kind !== 'number') {
        return { state, effects: [], out: [{ key: 'err.need_number' }, promptFor(state, ctx)] };
      }
      // The question asked for OTHER families, so the ambassador's own household is added on
      // top rather than expecting them to do the arithmetic.
      const total = intent.value + (state.includeSelf ? 1 : 0);
      if (intent.value < 1 || total > MAX_FAMILIES_PER_AMBASSADOR) {
        return {
          state,
          effects: [],
          out: [
            { key: 'err.family_count_range', params: { max: MAX_FAMILIES_PER_AMBASSADOR } },
            promptFor(state, ctx),
          ],
        };
      }
      const next: SessionState = { ...state, familyCount: total, cursor: 0, node: 'FAMILY_PHONE' };
      return { state: next, effects: [], out: [promptFor(next, ctx)] };
    }

    case 'FAMILY_PHONE': {
      if (intent.kind !== 'text') return reprompt(state, ctx);
      if (!isValidPhone(intent.value)) {
        return { state, effects: [], out: [{ key: 'err.phone_invalid' }, promptFor(state, ctx)] };
      }
      const phone = toE164(intent.value)!;

      // Reject a number already given earlier in THIS conversation. Without it, an ambassador
      // who fat-fingers the same number twice books "two" households that are one row, and the
      // second silently overwrites the first's answers — they'd leave with too little food.
      if (state.families.some((f) => f.phone === phone)) {
        return { state, effects: [], out: [{ key: 'err.phone_duplicate' }, promptFor(state, ctx)] };
      }

      // Ask the runner whether this household is already on file. The machine can't know.
      const next: SessionState = { ...state, partial: { ...state.partial, phone } };
      return { state: next, effects: [{ type: 'LOOKUP_FAMILY', phone }], out: [] };
    }

    case 'FAMILY_SIZE': {
      if (intent.kind !== 'number') {
        return { state, effects: [], out: [{ key: 'err.need_number' }, promptFor(state, ctx)] };
      }
      if (intent.value < 1 || intent.value > MAX_HOUSEHOLD_SIZE) {
        return { state, effects: [], out: [{ key: 'err.size_range' }, promptFor(state, ctx)] };
      }
      const next: SessionState = {
        ...state,
        partial: { ...state.partial, size: intent.value },
        node: 'FAMILY_ALLERGIES',
      };
      return { state: next, effects: [], out: [promptFor(next, ctx)] };
    }

    case 'FAMILY_ALLERGIES': {
      if (intent.kind !== 'select') return reprompt(state, ctx);
      const allergies: AllergyKind[] =
        intent.value === 'both'
          ? ['gluten_free', 'dairy_free']
          : intent.value === 'none'
            ? []
            : [intent.value as AllergyKind];

      return addFamily(state, ctx, {
        phone: state.partial.phone!,
        size: state.partial.size!,
        allergies,
        known: false,
      });
    }

    case 'SLOT_SELECT': {
      if (intent.kind !== 'select') {
        return { state, effects: [], out: [{ key: 'err.pick_listed_slot' }, promptFor(state, ctx)] };
      }
      const slot = ctx.slots.find((s) => s.id === intent.value);
      if (!slot) {
        return { state, effects: [], out: [{ key: 'err.pick_listed_slot' }, promptFor(state, ctx)] };
      }
      const next: SessionState = { ...state, selectedSlotId: slot.id, node: 'CONFIRM' };
      return { state: next, effects: [], out: [promptFor(next, ctx)] };
    }

    case 'CONFIRM': {
      if (intent.kind === 'no') {
        const next: SessionState = { ...state, selectedSlotId: null, node: 'SLOT_SELECT' };
        return { state: next, effects: [], out: [promptFor(next, ctx)] };
      }
      if (intent.kind !== 'yes') return reprompt(state, ctx);
      // The machine can't know whether the spot is still there — it asks the runner to try,
      // and handles either answer in handleEffectResult.
      return { state, effects: [{ type: 'BOOK', slotId: state.selectedSlotId! }], out: [] };
    }

    case 'DONE':
      return { state, effects: [], out: [{ key: 'msg.done_hint' }] };
  }
}

/**
 * Appends a completed household and moves on — to the next family, or to slot selection.
 * Shared by both paths into a household: answered questions, and recognised by phone.
 */
function addFamily(
  state: SessionState,
  ctx: TransitionContext,
  family: Omit<FamilyDraft, 'isSelf'>,
): TransitionOutput {
  const families: FamilyDraft[] = [
    ...state.families,
    {
      ...family,
      // Position 0 is the ambassador's own household when they said yes; for a plain family
      // signup the single household is always theirs.
      isSelf: state.includeSelf && state.cursor === 0,
    },
  ];

  const done = families.length >= (state.familyCount ?? 1);
  if (!done) {
    const next: SessionState = {
      ...state,
      families,
      partial: {},
      cursor: state.cursor + 1,
      node: 'FAMILY_PHONE',
    };
    return { state: next, effects: [], out: [promptFor(next, ctx)] };
  }

  if (ctx.slots.length === 0) {
    return {
      state: { ...state, families, partial: {}, node: 'SLOT_SELECT' },
      effects: [],
      out: [{ key: 'msg.no_slots' }],
    };
  }
  const next: SessionState = { ...state, families, partial: {}, node: 'SLOT_SELECT' };
  return { state: next, effects: [], out: [promptFor(next, ctx)] };
}

function handleEffectResult(
  state: SessionState,
  result: import('./types').EffectResult,
  ctx: TransitionContext,
): TransitionOutput {
  switch (result.kind) {
    // Already on file: reuse the stored size and restrictions, skip both questions.
    // Acknowledged rather than done in silence — otherwise two questions vanish with no
    // explanation and the ambassador wonders what they missed. The ack deliberately omits
    // the household's details, since whoever holds this phone shouldn't learn them by
    // guessing numbers.
    case 'family_known': {
      const step = addFamily(state, ctx, {
        phone: result.phone,
        size: result.size,
        allergies: result.allergies,
        known: true,
      });
      return { ...step, out: [{ key: 'msg.family_recognized' }, ...step.out] };
    }

    case 'family_new': {
      const next: SessionState = { ...state, node: 'FAMILY_SIZE' };
      return { state: next, effects: [], out: [promptFor(next, ctx)] };
    }

    case 'booked': {
      const next: SessionState = {
        ...state,
        node: 'DONE',
        confirmation: { code: result.code, slotStartsAt: result.slotStartsAt },
      };
      return {
        state: next,
        effects: [],
        out: [
          {
            key: 'msg.confirmed',
            params: {
              code: result.code,
              slotStartsAt: result.slotStartsAt,
              families: result.families,
              boxes: result.boxes,
            },
          },
        ],
      };
    }
    case 'already_booked':
      return { state: { ...state, node: 'DONE' }, effects: [], out: [{ key: 'msg.already_booked' }] };

    case 'slot_full': {
      // The spots_left we showed was a stale read by design. Losing the race is a normal
      // outcome, so we apologise and re-offer rather than erroring.
      const next: SessionState = { ...state, selectedSlotId: null, node: 'SLOT_SELECT' };
      const remaining = ctx.slots.filter((s) => s.spotsLeft > 0);
      if (remaining.length === 0) {
        return { state: next, effects: [], out: [{ key: 'msg.no_slots' }] };
      }
      return { state: next, effects: [], out: [{ key: 'msg.slot_full' }, promptFor(next, ctx)] };
    }
  }
}

/** BACK rewinds one question, including back across the family loop boundary. */
function stepBack(state: SessionState): SessionState {
  switch (state.node) {
    case 'ROLE_SELECT':
      return { ...state, node: 'LANG_SELECT' };
    case 'AMBASSADOR_OWN_HOUSEHOLD':
      return { ...state, node: 'ROLE_SELECT' };
    case 'FAMILY_COUNT':
      return { ...state, node: 'AMBASSADOR_OWN_HOUSEHOLD' };
    case 'FAMILY_PHONE': {
      if (state.cursor > 0) {
        // Re-open the previous household for editing rather than stranding the user.
        const families = state.families.slice(0, -1);
        return { ...state, families, cursor: state.cursor - 1, partial: {}, node: 'FAMILY_PHONE' };
      }
      return state.role === 'ambassador'
        ? { ...state, node: 'FAMILY_COUNT' }
        : { ...state, node: 'ROLE_SELECT' };
    }
    case 'FAMILY_SIZE':
      return { ...state, partial: {}, node: 'FAMILY_PHONE' };
    case 'FAMILY_ALLERGIES':
      return { ...state, node: 'FAMILY_SIZE' };
    case 'SLOT_SELECT': {
      // Re-open the last household. A recognised one has no questions to go back to, so it
      // rewinds to its phone prompt; otherwise back to its restrictions answer.
      const last = state.families.at(-1);
      const families = state.families.slice(0, -1);
      return {
        ...state,
        families,
        partial: last && !last.known ? { phone: last.phone, size: last.size } : {},
        node: last?.known ? 'FAMILY_PHONE' : 'FAMILY_ALLERGIES',
      };
    }
    case 'CONFIRM':
      return { ...state, selectedSlotId: null, node: 'SLOT_SELECT' };
    default:
      return state;
  }
}

function reprompt(state: SessionState, ctx: TransitionContext): TransitionOutput {
  return { state, effects: [], out: [{ key: 'err.unknown' }, promptFor(state, ctx)] };
}

/** The question for whatever node we're on. Also used to re-ask after an unparseable reply. */
export function promptFor(state: SessionState, ctx: TransitionContext): MessageSpec {
  switch (state.node) {
    case 'LANG_SELECT':
      return { key: 'prompt.lang_select' };
    case 'ROLE_SELECT':
      return { key: 'prompt.role_select' };
    case 'AMBASSADOR_OWN_HOUSEHOLD':
      return { key: 'prompt.ambassador_own_household' };
    case 'FAMILY_COUNT':
      return { key: 'prompt.family_count', params: { includeSelf: state.includeSelf } };
    case 'FAMILY_PHONE':
      return state.includeSelf && state.cursor === 0
        ? { key: 'prompt.family_phone_self' }
        : {
            key: 'prompt.family_phone',
            params: { position: state.cursor + 1, total: state.familyCount ?? 1 },
          };
    case 'FAMILY_SIZE':
      return { key: 'prompt.family_size', params: { phone: state.partial.phone ?? '' } };
    case 'FAMILY_ALLERGIES':
      return { key: 'prompt.family_allergies', params: { phone: state.partial.phone ?? '' } };
    case 'SLOT_SELECT':
      return {
        key: 'prompt.slot_select',
        params: {
          slots: ctx.slots.map((s, i) => ({
            index: i + 1,
            startsAt: s.startsAt.toISOString(),
            spotsLeft: s.spotsLeft,
          })),
        },
      };
    case 'CONFIRM': {
      const slot = ctx.slots.find((s) => s.id === state.selectedSlotId);
      return {
        key: 'prompt.confirm',
        params: {
          role: state.role ?? 'family',
          slotStartsAt: slot?.startsAt.toISOString() ?? '',
          families: state.families.map((f) => ({
            phone: f.phone,
            size: f.size,
            allergies: f.allergies,
            isSelf: f.isSelf,
          })),
          boxes: state.families.reduce((sum, f) => sum + tierFor(f.size, ctx.tiers).boxes, 0),
        },
      };
    }
    case 'DONE':
      return { key: 'msg.done_hint' };
  }
}
