import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Default region for bare 10-digit numbers. Hand-rolling this is a trap — people text
 * "(555) 010-0100", "555.010.0100", and "+1 555 010 0100" and all three are the same number.
 */
const DEFAULT_COUNTRY = 'US' as const;

export function isValidPhone(input: string): boolean {
  const parsed = parsePhoneNumberFromString(input, DEFAULT_COUNTRY);
  return parsed?.isValid() ?? false;
}

/**
 * Normalizes to E.164 so the same person isn't stored three different ways.
 *
 * This is load-bearing now that phone is a household's identity: "212-555-0100" and
 * "+1 (212) 555-0100" must collapse to one key, or the same family gets a fresh row every
 * week and the dedupe silently does nothing.
 */
export function toE164(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input, DEFAULT_COUNTRY);
  return parsed?.isValid() ? parsed.number : null;
}

/** Human-readable form for messages and the roster, e.g. "(212) 555-0100". */
export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed?.isValid() ? parsed.formatNational() : e164;
}
