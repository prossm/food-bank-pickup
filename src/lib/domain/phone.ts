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

/** Normalizes to E.164 so the same person isn't stored three different ways. */
export function toE164(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input, DEFAULT_COUNTRY);
  return parsed?.isValid() ? parsed.number : null;
}
