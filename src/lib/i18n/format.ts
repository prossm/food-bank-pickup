import type { Locale } from '@/lib/domain/types';

/**
 * The food bank's wall-clock timezone. Slots are "Wednesday 5pm" *there*, and Vercel runs in
 * UTC, so this has to be explicit — deriving it from the server would move the pickup by an
 * hour every DST changeover.
 */
export const FOOD_BANK_TZ = process.env.FOOD_BANK_TZ ?? 'America/New_York';

const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-US',
  es: 'es-US',
  zh: 'zh-CN',
};

/** e.g. "Wed, Jul 22 at 5:00 PM" — rendered in the food bank's timezone, not the reader's. */
export function formatSlot(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: FOOD_BANK_TZ,
  }).format(new Date(iso));
}
