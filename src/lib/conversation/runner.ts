import { transition, promptFor } from './machine';
import { keywordParser } from './parser/keyword-parser';
import { NODE_SPECS, slotOptions } from './nodes';
import type { Effect, EffectResult, IntentParser, SessionState, TransitionContext } from './types';
import { renderAll } from '@/lib/i18n/render';
import type { MessageSpec } from '@/lib/i18n/types';
import { listOpenSlots } from '@/lib/db/repos/slots';
import { listTiers } from '@/lib/db/repos/tiers';
import { bookPickup } from '@/lib/db/repos/pickups';
import { upsertContact } from '@/lib/db/repos/contacts';
import {
  getOrCreateSession,
  saveSession,
  appendMessages,
  listMessages,
  type StoredMessage,
} from '@/lib/db/repos/sessions';
import { boxesFor } from '@/lib/domain/food-tiers';
import type { Address, OutboundMessage } from '@/lib/transport/types';

/** Swappable so an LLM parser can be dropped in without touching the flow. */
const parser: IntentParser = keywordParser;

async function loadContext(): Promise<TransitionContext> {
  const [slots, tiers] = await Promise.all([listOpenSlots(), listTiers()]);
  return { slots, tiers };
}

/** The only place in the conversation layer that performs I/O. */
async function runEffect(
  effect: Effect,
  state: SessionState,
  ctx: TransitionContext,
  address: Address,
): Promise<{ result: EffectResult; contactId: string }> {
  const contact = await upsertContact(address.channel, address.externalId, state.locale);

  const slot = ctx.slots.find((s) => s.id === effect.slotId);
  const boxes = boxesFor(state.families.map((f) => f.size), ctx.tiers);

  const res = await bookPickup({
    slotId: effect.slotId,
    contactId: contact.id,
    role: state.role ?? 'family',
    families: state.families,
    tiers: ctx.tiers,
  });

  if (res.kind === 'booked') {
    return {
      contactId: contact.id,
      result: {
        kind: 'booked',
        code: res.code,
        slotStartsAt: slot?.startsAt.toISOString() ?? '',
        families: state.families.length,
        boxes,
      },
    };
  }
  return { contactId: contact.id, result: { kind: res.kind } };
}

/** Opens a conversation, sending the greeting if this is a brand new thread. */
export async function startConversation(address: Address): Promise<StoredMessage[]> {
  const session = await getOrCreateSession(address.channel, address.externalId);
  const existing = await listMessages(session.id);
  if (existing.length > 0) return existing;

  const ctx = await loadContext();
  const { out } = transition(session.state, { type: 'start' }, ctx);
  const bodies = renderAll(out, session.state.locale);
  await appendMessages(session.id, bodies.map((body) => ({ direction: 'outbound' as const, body })));
  return listMessages(session.id);
}

export async function processInbound(
  address: Address,
  text: string,
): Promise<{ messages: StoredMessage[]; outbound: OutboundMessage[] }> {
  const session = await getOrCreateSession(address.channel, address.externalId);
  let state = session.state;

  await appendMessages(session.id, [{ direction: 'inbound', body: text }]);

  const ctx = await loadContext();
  const specs: MessageSpec[] = [];

  // A reset means the stored state didn't match this build of the machine. Say so rather
  // than replying to a question the user can no longer see — and persist the fresh state,
  // or the next message would reset all over again, forever.
  if (session.wasReset) {
    specs.push({ key: 'msg.restarted' }, promptFor(state, ctx));
    await saveSession(session.id, state, session.version, session.contactId);
  } else {
    const nodeSpec = NODE_SPECS[state.node];
    const options = state.node === 'SLOT_SELECT' ? slotOptions(ctx.slots) : (nodeSpec.options ?? []);
    const intent = await parser.parse({ text, node: state.node, locale: state.locale, options });

    let step = transition(state, { type: 'intent', intent }, ctx);
    state = step.state;
    specs.push(...step.out);

    let contactId: string | null = session.contactId;
    for (const effect of step.effects) {
      const { result, contactId: cid } = await runEffect(effect, state, ctx, address);
      contactId = cid;
      // Re-enter the machine with what actually happened. This is how a pure reducer copes
      // with a race it cannot predict — it never guesses whether the spot was still free.
      const after = transition(state, { type: 'effectResult', result }, ctx);
      state = after.state;
      specs.push(...after.out);
    }

    const saved = await saveSession(session.id, state, session.version, contactId);
    if (!saved) {
      // Someone else advanced this conversation while we were working — a double-send.
      // Drop this reply rather than interleaving two half-applied turns.
      return { messages: await listMessages(session.id), outbound: [] };
    }
  }

  const bodies = renderAll(specs, state.locale);
  await appendMessages(session.id, bodies.map((body) => ({ direction: 'outbound' as const, body })));

  return {
    messages: await listMessages(session.id),
    outbound: bodies.map((body) => ({ body })),
  };
}
