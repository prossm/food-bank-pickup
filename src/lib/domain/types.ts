/**
 * `zh` is declared but not yet offered: the DB enum and the state schema already accept it, so
 * adding Mandarin is a catalog file plus a LANG_SELECT option, with no migration. Only locales
 * present in i18n/render.ts's catalog map are reachable today.
 */
export type Locale = 'en' | 'es' | 'zh';

export type PickupRole = 'ambassador' | 'family';

export type AllergyKind = 'gluten_free' | 'dairy_free';

export interface FamilyDraft {
  /**
   * E.164. The household's identity — an ambassador knows the numbers of the people they
   * deliver to, not their surnames, so this is what we dedupe on. Required by the flow;
   * over SMS/WhatsApp it arrives with the message.
   */
  phone: string;
  size: number;
  allergies: AllergyKind[];
  /** True for the ambassador's own household, so staff know who the driver is collecting for. */
  isSelf?: boolean;
  /** True when this phone was already on file and its size/allergies were reused. */
  known?: boolean;
}

export interface FoodTier {
  id: string;
  minSize: number;
  maxSize: number | null;
  boxes: number;
  labelKey: string;
}

export interface SlotView {
  id: string;
  startsAt: Date;
  capacity: number;
  spotsUsed: number;
  spotsLeft: number;
}
