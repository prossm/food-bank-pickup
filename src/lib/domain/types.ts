export type Locale = 'en' | 'es' | 'zh';

/** Locales with a complete message catalog. Mandarin is deferred; see i18n/catalog. */
export const ACTIVE_LOCALES: readonly Locale[] = ['en', 'es'] as const;

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
