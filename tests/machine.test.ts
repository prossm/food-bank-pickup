import { describe, it, expect } from 'vitest';
import { transition } from '@/lib/conversation/machine';
import { initialState, type SessionState, type TransitionContext } from '@/lib/conversation/types';
import { keywordParser } from '@/lib/conversation/parser/keyword-parser';
import { NODE_SPECS, slotOptions } from '@/lib/conversation/nodes';
import { render } from '@/lib/i18n/render';
import type { FoodTier, SlotView } from '@/lib/domain/types';

const TIERS: FoodTier[] = [
  { id: 'small', minSize: 1, maxSize: 2, boxes: 1, labelKey: 'tier.small' },
  { id: 'medium', minSize: 3, maxSize: 5, boxes: 2, labelKey: 'tier.medium' },
  { id: 'large', minSize: 6, maxSize: null, boxes: 3, labelKey: 'tier.large' },
];

const SLOTS: SlotView[] = [
  {
    id: 'slot-5pm',
    startsAt: new Date('2026-07-22T21:00:00Z'), // 5:00pm America/New_York
    capacity: 30,
    spotsUsed: 18,
    spotsLeft: 12,
  },
  {
    id: 'slot-530pm',
    startsAt: new Date('2026-07-22T21:30:00Z'),
    capacity: 30,
    spotsUsed: 0,
    spotsLeft: 30,
  },
];

const CTX: TransitionContext = { slots: SLOTS, tiers: TIERS };

/**
 * Drives the machine the way the runner does — through the real parser — so these tests
 * cover text→intent→state end to end, minus the I/O.
 */
async function say(state: SessionState, text: string, ctx: TransitionContext = CTX) {
  const spec = NODE_SPECS[state.node];
  const options = state.node === 'SLOT_SELECT' ? slotOptions(ctx.slots) : (spec.options ?? []);
  const intent = await keywordParser.parse({ text, node: state.node, locale: state.locale, options });
  return transition(state, { type: 'intent', intent }, ctx);
}

/** Replays a whole conversation, returning the final state and every message sent. */
async function converse(texts: string[], ctx: TransitionContext = CTX) {
  let state = initialState();
  const sent: string[] = [];
  for (const t of texts) {
    const r = await say(state, t, ctx);
    state = r.state;
    sent.push(...r.out.map((s) => render(s, state.locale)));
    if (r.effects.length) return { state, sent, effects: r.effects };
  }
  return { state, sent, effects: [] };
}

describe('happy path — a family signing up for itself', () => {
  it('collects one household and reaches CONFIRM without asking how many families', async () => {
    const { state, sent } = await converse(['1', '2', 'Chen', 'skip', '4', '4']);

    expect(state.node).toBe('SLOT_SELECT');
    expect(state.families).toEqual([
      { name: 'Chen', phone: null, size: 4, allergies: [], isSelf: true },
    ]);
    // Never asked "how many families" — it's implicitly one.
    expect(sent.join('\n')).not.toMatch(/how many families/i);
    // The slot list shows real remaining spots.
    expect(sent.at(-1)).toContain('12 spots left');
    expect(sent.at(-1)).toContain('30 spots left');
  });

  it('emits a BOOK effect on confirm rather than touching a database', async () => {
    const { effects, state } = await converse(['1', '2', 'Chen', 'skip', '4', '4', '1', 'yes']);
    expect(effects).toEqual([{ type: 'BOOK', slotId: 'slot-5pm' }]);
    expect(state.node).toBe('CONFIRM');
  });
});

describe('happy path — an ambassador for several families', () => {
  it('counts the ambassador household on top of the OTHER families they name', async () => {
    const { state } = await converse([
      '1', '1',            // English, ambassador
      'yes',               // picking up for their own household too
      '2',                 // two OTHER families
      'Alvarez', 'skip', '4', '4',
      'Chen', 'skip', '6', '1',
      'Diallo', 'skip', '2', '3',
    ]);

    expect(state.familyCount).toBe(3); // 2 others + their own
    expect(state.families.map((f) => f.name)).toEqual(['Alvarez', 'Chen', 'Diallo']);
    expect(state.families[0].isSelf).toBe(true);
    expect(state.families[1].isSelf).toBe(false);
    expect(state.families[1].allergies).toEqual(['gluten_free']);
    expect(state.families[2].allergies).toEqual(['gluten_free', 'dairy_free']);
    expect(state.node).toBe('SLOT_SELECT');
  });

  it('does not add a self household when the ambassador is a pure courier', async () => {
    const { state } = await converse([
      '1', '1', 'no', '2',
      'Alvarez', 'skip', '4', '4',
      'Chen', 'skip', '6', '4',
    ]);
    expect(state.familyCount).toBe(2);
    expect(state.families.every((f) => !f.isSelf)).toBe(true);
  });

  it('shows the right box total on the confirm summary — 4+6+2 people = 2+3+1 boxes', async () => {
    const { sent } = await converse([
      '1', '1', 'no', '3',
      'Alvarez', 'skip', '4', '4',
      'Chen', 'skip', '6', '4',
      'Diallo', 'skip', '2', '4',
      '1',
    ]);
    const summary = sent.at(-1)!;
    expect(summary).toContain('6 boxes');
    expect(summary).toContain('Alvarez — 4 people');
    expect(summary).toContain('Chen — 6 people');
  });
});

describe('input handling', () => {
  it('accepts Spanish words, accent-free spellings, and fullwidth digits', async () => {
    const a = await converse(['2']); // Español
    expect(a.state.locale).toBe('es');
    expect(a.sent.at(-1)).toContain('¿Recoge solo para su hogar');

    const b = await converse(['２']); // fullwidth 2 from a CJK keyboard
    expect(b.state.locale).toBe('es');

    // "si" without the accent, which is how people actually text
    const c = await converse(['2', '1', 'si']);
    expect(c.state.includeSelf).toBe(true);
    expect(c.state.node).toBe('FAMILY_COUNT');
  });

  it('re-asks instead of advancing when a reply makes no sense', async () => {
    const { state, sent } = await converse(['1', 'purple monkey']);
    expect(state.node).toBe('ROLE_SELECT'); // did not move on
    expect(sent.join()).toContain("didn't catch that");
  });

  it('rejects a household size of zero and an absurd family count', async () => {
    const zero = await converse(['1', '2', 'Chen', 'skip', '0']);
    expect(zero.state.node).toBe('FAMILY_SIZE');
    expect(zero.sent.join()).toContain('between 1 and 30');

    const many = await converse(['1', '1', 'no', '40']);
    expect(many.state.node).toBe('FAMILY_COUNT');
    expect(many.sent.join()).toContain('call the food bank');
  });

  it('validates phone numbers but lets people skip', async () => {
    const bad = await converse(['1', '2', 'Chen', '12']);
    expect(bad.state.node).toBe('FAMILY_PHONE');
    expect(bad.sent.join()).toContain("doesn't look like a phone number");

    // 555 is not a real area code, so this is correctly rejected — worth pinning down,
    // because it's exactly the fake number a tester reaches for first.
    const fake = await converse(['1', '2', 'Chen', '(555) 010-0100']);
    expect(fake.state.node).toBe('FAMILY_PHONE');

    const good = await converse(['1', '2', 'Chen', '(212) 555-0100']);
    expect(good.state.node).toBe('FAMILY_SIZE');
    expect(good.state.partial.phone).toBe('+12125550100');
  });

  it('normalizes however someone happens to type their number', async () => {
    for (const written of ['2125550100', '212-555-0100', '+1 212 555 0100', '(212) 555 0100']) {
      const r = await converse(['1', '2', 'Chen', written]);
      expect(r.state.partial.phone, `${written} should normalize`).toBe('+12125550100');
    }
  });
});

describe('global commands', () => {
  it('RESTART wipes collected families', async () => {
    const { state } = await converse(['1', '2', 'Chen', 'skip', '4', '4', 'restart']);
    expect(state.node).toBe('LANG_SELECT');
    expect(state.families).toEqual([]);
  });

  it('HELP answers without losing the current question', async () => {
    const { state, sent } = await converse(['1', '2', 'Chen', 'help']);
    expect(state.node).toBe('FAMILY_PHONE');
    expect(state.partial.name).toBe('Chen');
    expect(sent.join()).toContain('(555) 010-0100');
  });

  it('BACK re-opens the previous household mid-loop instead of stranding the user', async () => {
    const { state } = await converse([
      '1', '1', 'no', '2',
      'Alvarez', 'skip', '4', '4',
      'back', // partway into family 2, go back to family 1
    ]);
    expect(state.node).toBe('FAMILY_NAME');
    expect(state.cursor).toBe(0);
    expect(state.families).toEqual([]); // Alvarez re-opened for editing
  });

  it('BACK wins over a household surname that collides with the keyword', async () => {
    // A deliberate trade: "back" at the name prompt means the command, so the rare household
    // named Back must give a different name. Someone fixing a typo is far more common, and
    // without this they would have no way to correct it.
    const { state } = await converse(['1', '2', 'Back']);
    expect(state.node).toBe('ROLE_SELECT');
    expect(state.partial.name).toBeUndefined();
  });
});

describe('losing the race for a spot', () => {
  it('apologises and re-offers when the slot filled up mid-conversation', async () => {
    const { state } = await converse(['1', '2', 'Chen', 'skip', '4', '4', '1', 'yes']);
    const after = transition(state, { type: 'effectResult', result: { kind: 'slot_full' } }, CTX);

    expect(after.state.node).toBe('SLOT_SELECT');
    expect(after.state.selectedSlotId).toBeNull();
    expect(render(after.out[0], 'en')).toContain('filled up');
    // The family data survives — they don't re-enter five households.
    expect(after.state.families).toHaveLength(1);
  });

  it('tells the user when nothing is left at all', async () => {
    const full: TransitionContext = {
      tiers: TIERS,
      slots: SLOTS.map((s) => ({ ...s, spotsLeft: 0, spotsUsed: 30 })),
    };
    const { state } = await converse(['1', '2', 'Chen', 'skip', '4', '4', '1', 'yes'], full);
    const after = transition(state, { type: 'effectResult', result: { kind: 'slot_full' } }, full);
    expect(render(after.out[0], 'en')).toContain('full right now');
  });

  it('confirms with a code once the booking succeeds', async () => {
    const { state } = await converse(['1', '2', 'Chen', 'skip', '4', '4', '1', 'yes']);
    const after = transition(
      state,
      {
        type: 'effectResult',
        result: {
          kind: 'booked',
          code: 'H4KM7Q',
          slotStartsAt: '2026-07-22T21:00:00Z',
          families: 1,
          boxes: 2,
        },
      },
      CTX,
    );
    expect(after.state.node).toBe('DONE');
    expect(render(after.out[0], 'en')).toContain('H4KM7Q');
  });
});

describe('purity', () => {
  it('never mutates the state it was handed', async () => {
    const state = initialState();
    const frozen = JSON.stringify(state);
    await say(state, '1');
    expect(JSON.stringify(state)).toBe(frozen);
  });
});
