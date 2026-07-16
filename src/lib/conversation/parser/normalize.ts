/**
 * Folds user input down to something matchable.
 *
 * NFKC first, because a Mandarin or Japanese keyboard sends fullwidth digits (`１`) that are
 * not `1`, and users on phone keyboards send curly quotes. Then diacritics are stripped so
 * "sí" matches "si" — people text without accents constantly, and refusing them would gate
 * the flow on typography.
 */
export function normalize(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .replace(/[^\p{L}\p{N}\s+-]/gu, ' ') // punctuation/emoji to space; keep + and - for phones
    .replace(/\s+/g, ' ')
    .trim();
}

/** Preserves the user's original text (names!) but tidies whitespace. */
export function tidy(input: string): string {
  return input.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * Pulls a non-negative integer out of a reply. Accepts digits and small number words in
 * English and Spanish, since "two" and "dos" are what people actually text.
 */
const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  cero: 0, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};

export function parseNumber(input: string): number | null {
  const n = normalize(input);
  const digits = n.match(/\d+/);
  if (digits) {
    const value = Number(digits[0]);
    return Number.isSafeInteger(value) ? value : null;
  }
  for (const token of n.split(' ')) {
    if (token in WORD_NUMBERS) return WORD_NUMBERS[token];
  }
  return null;
}
