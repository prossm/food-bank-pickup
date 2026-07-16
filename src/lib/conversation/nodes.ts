import type { Node, Option } from './types';
import type { SlotView } from '@/lib/domain/types';

export type InputKind = 'select' | 'yesno' | 'number' | 'text' | 'phone';

export interface NodeSpec {
  input: InputKind;
  options?: Option[];
}

/**
 * Keywords are stored normalized (lowercase, no diacritics) — see parser/normalize.ts.
 * Every option accepts its digit, its English word, and its Spanish word, because someone
 * who selected Spanish still might type "1", and someone on a flip phone types digits only.
 */
export const NODE_SPECS: Record<Node, NodeSpec> = {
  LANG_SELECT: {
    input: 'select',
    options: [
      { value: 'en', keys: ['1', 'english', 'ingles', 'en'] },
      { value: 'es', keys: ['2', 'espanol', 'spanish', 'es', 'castellano'] },
    ],
  },
  ROLE_SELECT: {
    input: 'select',
    options: [
      {
        value: 'ambassador',
        keys: ['1', 'ambassador', 'embajador', 'embajadora', 'voluntario', 'voluntaria',
               'volunteer', 'several', 'varias', 'multiple', 'families', 'familias'],
      },
      {
        value: 'family',
        keys: ['2', 'family', 'familia', 'mine', 'my household', 'mi hogar', 'just me',
               'solo yo', 'me', 'yo', 'myself', 'household', 'hogar'],
      },
    ],
  },
  AMBASSADOR_OWN_HOUSEHOLD: { input: 'yesno' },
  FAMILY_COUNT: { input: 'number' },
  FAMILY_NAME: { input: 'text' },
  FAMILY_PHONE: { input: 'phone' },
  FAMILY_SIZE: { input: 'number' },
  FAMILY_ALLERGIES: {
    input: 'select',
    options: [
      { value: 'gluten_free', keys: ['1', 'gluten', 'gluten free', 'sin gluten', 'celiac', 'celiaco'] },
      { value: 'dairy_free', keys: ['2', 'dairy', 'dairy free', 'lacteos', 'sin lacteos', 'milk', 'leche'] },
      { value: 'both', keys: ['3', 'both', 'ambas', 'ambos', 'los dos', 'gluten and dairy'] },
      { value: 'none', keys: ['4', 'none', 'ninguna', 'ninguno', 'no', 'nada', 'n a'] },
    ],
  },
  SLOT_SELECT: { input: 'select' },
  CONFIRM: { input: 'yesno' },
  DONE: { input: 'text' },
};

/** SLOT_SELECT's options depend on what's open right now, so they're built per request. */
export function slotOptions(slots: SlotView[]): Option[] {
  return slots.map((s, i) => ({ value: s.id, keys: [String(i + 1)] }));
}

export const YES_KEYS = ['yes', 'y', 'yeah', 'yep', 'ok', 'okay', 'sure', 'si', 'sii',
                         'claro', 'correcto', 'confirmar', 'confirm', '1'];
export const NO_KEYS = ['no', 'n', 'nope', 'nah', 'negativo', '2'];
export const SKIP_KEYS = ['skip', 'omitir', 'saltar', 'none', 'ninguno', 'no tengo', 'no'];
export const RESTART_KEYS = ['restart', 'start over', 'reiniciar', 'empezar de nuevo', 'reset'];
export const HELP_KEYS = ['help', 'ayuda', 'info', 'socorro'];
export const BACK_KEYS = ['back', 'atras', 'regresar', 'volver', 'undo'];
