import type { Catalog } from '../types';
import { formatSlot } from '../format';

const allergyName: Record<string, string> = {
  gluten_free: 'gluten free',
  dairy_free: 'dairy free',
};

function allergyList(kinds: string[]): string {
  if (kinds.length === 0) return 'no restrictions';
  return kinds.map((k) => allergyName[k] ?? k).join(', ');
}

export const en: Catalog = {
  // Sent before we know who we're talking to, so it carries both languages itself.
  'prompt.lang_select': () =>
    'Hi! This is the food bank pickup sign-up. 🥕\n' +
    'Reply 1 for English\n' +
    'Responda 2 para Español',

  'prompt.role_select': () =>
    'Are you picking up for just your own household, or for several families?\n' +
    '1 — Several families (I volunteer as an ambassador)\n' +
    '2 — Just my household',

  'prompt.ambassador_own_household': () =>
    'Thanks for volunteering! Are you also picking up food for your own household?\n' +
    'Reply YES or NO',

  'prompt.family_count': ({ includeSelf }) =>
    includeSelf
      ? 'How many OTHER families are you picking up for, besides your own? (Reply with a number)'
      : 'How many families are you picking up for? (Reply with a number)',

  'prompt.family_name': ({ position, total }) =>
    `Family ${position} of ${total}: what's their last name?`,

  'prompt.family_name_self': () => "What's your last name?",

  'prompt.family_phone': ({ name }) =>
    `Phone number for ${name}? (Reply SKIP if you don't have one)`,

  'prompt.family_size': ({ name }) => `How many people are in the ${name} household?`,

  'prompt.family_allergies': ({ name }) =>
    `Any food restrictions for ${name}?\n` +
    '1 — Gluten free\n' +
    '2 — Dairy free\n' +
    '3 — Both\n' +
    '4 — None',

  'prompt.slot_select': ({ slots }) =>
    'Which pickup time works?\n' +
    slots
      .map(
        (s) =>
          `${s.index} — ${formatSlot(s.startsAt, 'en')} (${s.spotsLeft} ${
            s.spotsLeft === 1 ? 'spot' : 'spots'
          } left)`,
      )
      .join('\n'),

  'prompt.confirm': ({ slotStartsAt, families, boxes }) =>
    'Please check this over:\n' +
    `📅 ${formatSlot(slotStartsAt, 'en')}\n` +
    families
      .map(
        (f) =>
          `• ${f.name}${f.isSelf ? ' (you)' : ''} — ${f.size} ${
            f.size === 1 ? 'person' : 'people'
          }, ${allergyList(f.allergies)}`,
      )
      .join('\n') +
    `\n📦 ${boxes} ${boxes === 1 ? 'box' : 'boxes'} total\n\n` +
    'Reply YES to confirm, or RESTART to start over.',

  'msg.confirmed': ({ code, slotStartsAt, families, boxes }) =>
    "You're confirmed! ✅\n" +
    `📅 ${formatSlot(slotStartsAt, 'en')}\n` +
    `👨‍👩‍👧 ${families} ${families === 1 ? 'household' : 'households'}, ${boxes} ${
      boxes === 1 ? 'box' : 'boxes'
    }\n` +
    `🎟️ Confirmation code: ${code}\n\n` +
    "Show this code at pickup. We'll text you a reminder before then.",

  'msg.slot_full': () =>
    'Sorry — that time filled up while we were talking. Please pick another:',

  'msg.no_slots': () =>
    'All pickup times are full right now. Please check back — we open new slots weekly.',

  'msg.already_booked': () => "You're already signed up for that time. 🎟️",

  'msg.help': () =>
    'Reply RESTART to start over, or BACK to fix your last answer. ' +
    'Questions? Call the food bank at (555) 010-0100.',

  'msg.restarted': () => "No problem — let's start over.",

  'msg.reminder': ({ slotStartsAt, code }) =>
    `Reminder: your food pickup is ${formatSlot(slotStartsAt, 'en')}. ` +
    `Your code is ${code}. See you there! 🥕`,

  'msg.done_hint': () => 'Reply RESTART if you need to sign up someone else.',

  'err.unknown': () => "Sorry, I didn't catch that.",
  'err.need_number': () => 'Please reply with a number.',
  'err.family_count_range': ({ max }) =>
    `Please reply with a number between 1 and ${max}. ` +
    `For more than ${max} families, please call the food bank.`,
  'err.size_range': () => 'Please reply with a household size between 1 and 30.',
  'err.name_length': () => 'Please reply with a name (under 120 characters).',
  'err.phone_invalid': () =>
    "That doesn't look like a phone number. Try again, or reply SKIP.",
  'err.pick_listed_slot': () => 'Please reply with the number next to a time above.',

  'allergy.gluten_free': () => 'gluten free',
  'allergy.dairy_free': () => 'dairy free',
  'allergy.none': () => 'no restrictions',

  'tier.small': () => 'small',
  'tier.medium': () => 'medium',
  'tier.large': () => 'large',
};
