import type { Catalog } from '../types';
import { formatSlot } from '../format';
import { formatPhone } from '@/lib/domain/phone';

const allergyName: Record<string, string> = {
  gluten_free: 'sin gluten',
  dairy_free: 'sin lácteos',
};

function allergyList(kinds: string[]): string {
  if (kinds.length === 0) return 'sin restricciones';
  return kinds.map((k) => allergyName[k] ?? k).join(', ');
}

export const es: Catalog = {
  'prompt.lang_select': () =>
    '¡Hola! Inscripción para recoger alimentos. 🥕\n' +
    'Reply 1 for English\n' +
    'Responda 2 para Español',

  'prompt.role_select': () =>
    '¿Recoge solo para su hogar, o para varias familias?\n' +
    '1 — Varias familias (soy embajador/a voluntario/a)\n' +
    '2 — Solo mi hogar',

  'prompt.ambassador_own_household': () =>
    '¡Gracias por ser voluntario/a! ¿También recoge alimentos para su propio hogar?\n' +
    'Responda SÍ o NO',

  'prompt.family_count': ({ includeSelf }) =>
    includeSelf
      ? '¿Para cuántas OTRAS familias recoge, además de la suya? (Responda con un número)'
      : '¿Para cuántas familias recoge? (Responda con un número)',

  'prompt.family_phone': ({ position, total }) =>
    `Familia ${position} de ${total}: ¿cuál es su número de teléfono?`,

  'prompt.family_phone_self': () => '¿Cuál es su número de teléfono?',

  'prompt.family_size': ({ phone }) =>
    `¿Cuántas personas hay en el hogar ${formatPhone(phone)}?`,

  'prompt.family_allergies': ({ phone }) =>
    `¿Alguna restricción alimentaria para ${formatPhone(phone)}?\n` +
    '1 — Sin gluten\n' +
    '2 — Sin lácteos\n' +
    '3 — Ambas\n' +
    '4 — Ninguna',

  'prompt.slot_select': ({ slots }) =>
    '¿Qué hora le conviene?\n' +
    slots
      .map(
        (s) =>
          `${s.index} — ${formatSlot(s.startsAt, 'es')} (${s.spotsLeft} ${
            s.spotsLeft === 1 ? 'lugar disponible' : 'lugares disponibles'
          })`,
      )
      .join('\n'),

  'prompt.confirm': ({ slotStartsAt, families, boxes }) =>
    'Por favor revise:\n' +
    `📅 ${formatSlot(slotStartsAt, 'es')}\n` +
    families
      .map(
        (f) =>
          `• ${formatPhone(f.phone)}${f.isSelf ? ' (usted)' : ''} — ${f.size} ${
            f.size === 1 ? 'persona' : 'personas'
          }, ${allergyList(f.allergies)}`,
      )
      .join('\n') +
    `\n📦 ${boxes} ${boxes === 1 ? 'caja' : 'cajas'} en total\n\n` +
    'Responda SÍ para confirmar, o REINICIAR para empezar de nuevo.',

  'msg.confirmed': ({ code, slotStartsAt, families, boxes }) =>
    '¡Confirmado! ✅\n' +
    `📅 ${formatSlot(slotStartsAt, 'es')}\n` +
    `👨‍👩‍👧 ${families} ${families === 1 ? 'hogar' : 'hogares'}, ${boxes} ${
      boxes === 1 ? 'caja' : 'cajas'
    }\n` +
    `🎟️ Código de confirmación: ${code}\n\n` +
    'Muestre este código al recoger. Le enviaremos un recordatorio.',

  'msg.slot_full': () =>
    'Lo sentimos — esa hora se llenó mientras hablábamos. Por favor elija otra:',

  'msg.no_slots': () =>
    'Todas las horas están llenas por ahora. Vuelva a consultar — abrimos lugares cada semana.',

  'msg.already_booked': () => 'Ya está inscrito/a para esa hora. 🎟️',

  'msg.help': () =>
    'Responda REINICIAR para empezar de nuevo, o ATRÁS para corregir su última respuesta. ' +
    '¿Preguntas? Llame al banco de alimentos al (555) 010-0100.',

  'msg.restarted': () => 'No hay problema — empecemos de nuevo.',

  'msg.reminder': ({ slotStartsAt, code }) =>
    `Recordatorio: su recogida de alimentos es el ${formatSlot(slotStartsAt, 'es')}. ` +
    `Su código es ${code}. ¡Nos vemos! 🥕`,

  'msg.done_hint': () => 'Responda REINICIAR si necesita inscribir a alguien más.',

  'msg.family_recognized': () => 'Listo — ese hogar ya está registrado. ✓',

  'err.unknown': () => 'Disculpe, no entendí eso.',
  'err.need_number': () => 'Por favor responda con un número.',
  'err.family_count_range': ({ max }) =>
    `Por favor responda con un número entre 1 y ${max}. ` +
    `Para más de ${max} familias, llame al banco de alimentos.`,
  'err.size_range': () => 'Por favor responda con un tamaño de hogar entre 1 y 30.',
  'err.phone_invalid': () => 'Eso no parece un número de teléfono. Intente de nuevo.',
  'err.phone_duplicate': () =>
    'Ya agregó ese número de teléfono. Por favor use uno diferente.',
  'err.pick_listed_slot': () => 'Por favor responda con el número junto a una hora de arriba.',

  'allergy.gluten_free': () => 'sin gluten',
  'allergy.dairy_free': () => 'sin lácteos',
  'allergy.none': () => 'sin restricciones',

  'tier.small': () => 'pequeña',
  'tier.medium': () => 'mediana',
  'tier.large': () => 'grande',
};
