import type { Intent, IntentParser, ParseContext } from '../types';
import { NODE_SPECS, YES_KEYS, NO_KEYS, RESTART_KEYS, HELP_KEYS, BACK_KEYS } from '../nodes';
import { normalize, tidy, parseNumber } from './normalize';

function matches(normalized: string, keys: string[]): boolean {
  if (keys.includes(normalized)) return true;
  const tokens = normalized.split(' ');
  // Multi-word keys ("start over") match as a phrase; single-word keys match a token, so
  // "yes please" and "ok thanks" work without matching "no" inside "nothing".
  return keys.some((k) => (k.includes(' ') ? normalized.includes(k) : tokens.includes(k)));
}

/**
 * Deterministic menu/keyword matching — no model, no API key, no nondeterminism.
 *
 * This is what real SMS services do, and it's what works on a flip phone with a bad signal.
 * It implements IntentParser so an LLM-backed parser can replace it without the state
 * machine changing at all.
 */
export class KeywordParser implements IntentParser {
  async parse(ctx: ParseContext): Promise<Intent> {
    const raw = ctx.text;
    const n = normalize(raw);
    if (!n) return { kind: 'unknown', raw };

    const spec = NODE_SPECS[ctx.node];

    // Global intents win everywhere, including at the name prompt. That's the SMS convention
    // (STOP and HELP work mid-flow on every service), and it costs us the household whose
    // surname is literally "Back" or "Help" — a trade worth making, since someone typing
    // "back" after a typo is enormously more common than that name, and they'd otherwise be
    // stuck with no way to correct it. Such a household can reply with a first name instead.
    if (matches(n, RESTART_KEYS)) return { kind: 'restart' };
    if (matches(n, HELP_KEYS)) return { kind: 'help' };
    if (matches(n, BACK_KEYS)) return { kind: 'back' };

    switch (spec.input) {
      case 'yesno': {
        // Checked before NO_KEYS: "si" and "yes" are unambiguous, and NO_KEYS's "2" would
        // otherwise never be reachable from a numeric reply.
        if (matches(n, YES_KEYS)) return { kind: 'yes' };
        if (matches(n, NO_KEYS)) return { kind: 'no' };
        return { kind: 'unknown', raw };
      }

      case 'number': {
        const value = parseNumber(raw);
        return value === null ? { kind: 'unknown', raw } : { kind: 'number', value };
      }

      case 'text': {
        return { kind: 'text', value: tidy(raw) };
      }

      case 'select': {
        const options = ctx.options.length ? ctx.options : (spec.options ?? []);
        for (const opt of options) {
          if (matches(n, opt.keys)) return { kind: 'select', value: opt.value };
        }
        return { kind: 'unknown', raw };
      }
    }
  }
}

export const keywordParser = new KeywordParser();
