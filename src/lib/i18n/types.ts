import type { AllergyKind, PickupRole } from '@/lib/domain/types';

export interface SlotOption {
  index: number;
  /** ISO instant. Formatting is the renderer's job — the machine stays free of locale and tz. */
  startsAt: string;
  spotsLeft: number;
}

export interface ConfirmSummary {
  role: PickupRole;
  slotStartsAt: string;
  /** Households are identified by phone now — names are the admin's to fill in. */
  families: { phone: string; size: number; allergies: AllergyKind[]; isSelf?: boolean }[];
  boxes: number;
}

/**
 * Every message the bot can send, with its parameters.
 *
 * Because Catalog is derived from this map, a locale missing a single string is a COMPILE
 * error rather than a runtime hole — which matters when the people relying on the Spanish
 * copy aren't the people writing it.
 */
export interface MessageParams {
  'prompt.lang_select': undefined;
  'prompt.role_select': undefined;
  'prompt.ambassador_own_household': undefined;
  'prompt.family_count': { includeSelf: boolean };
  'prompt.family_phone': { position: number; total: number };
  'prompt.family_phone_self': undefined;
  'prompt.family_size': { phone: string };
  'prompt.family_allergies': { phone: string };
  'prompt.slot_select': { slots: SlotOption[] };
  'prompt.confirm': ConfirmSummary;

  'msg.confirmed': { code: string; slotStartsAt: string; families: number; boxes: number };
  'msg.slot_full': undefined;
  'msg.no_slots': undefined;
  'msg.already_booked': undefined;
  'msg.help': undefined;
  'msg.restarted': undefined;
  'msg.reminder': { slotStartsAt: string; code: string };
  'msg.done_hint': undefined;
  /** Deliberately carries no household details — see handleEffectResult. */
  'msg.family_recognized': undefined;

  'err.unknown': undefined;
  'err.need_number': undefined;
  'err.family_count_range': { max: number };
  'err.size_range': undefined;
  'err.phone_invalid': undefined;
  'err.phone_duplicate': undefined;
  'err.pick_listed_slot': undefined;

  'allergy.gluten_free': undefined;
  'allergy.dairy_free': undefined;
  'allergy.none': undefined;

  'tier.small': undefined;
  'tier.medium': undefined;
  'tier.large': undefined;
}

export type MessageKey = keyof MessageParams;

export type Catalog = {
  [K in MessageKey]: (params: MessageParams[K]) => string;
};

/** A message the machine wants sent, before it becomes words. */
export type MessageSpec = {
  [K in MessageKey]: MessageParams[K] extends undefined
    ? { key: K; params?: undefined }
    : { key: K; params: MessageParams[K] };
}[MessageKey];
