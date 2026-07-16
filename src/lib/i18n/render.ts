import type { Locale } from '@/lib/domain/types';
import type { Catalog, MessageSpec } from './types';
import { en } from './catalog/en';
import { es } from './catalog/es';

/**
 * Only locales with a complete catalog appear here. Mandarin is deferred for v1 — adding it
 * is one file plus one line, and the Catalog type will refuse to compile until every string
 * is translated.
 */
const catalogs: Partial<Record<Locale, Catalog>> = { en, es };

export function catalogFor(locale: Locale): Catalog {
  return catalogs[locale] ?? en;
}

export function render(spec: MessageSpec, locale: Locale): string {
  const catalog = catalogFor(locale);
  const fn = catalog[spec.key] as (p: unknown) => string;
  return fn(spec.params);
}

export function renderAll(specs: MessageSpec[], locale: Locale): string[] {
  return specs.map((s) => render(s, locale));
}
