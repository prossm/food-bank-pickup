import type { PoolClient } from 'pg';
import { query } from '../client';
import type { Locale } from '@/lib/domain/types';

export interface Contact {
  id: string;
  channel: string;
  externalId: string;
  locale: Locale;
}

interface ContactRow extends Record<string, unknown> {
  id: string;
  channel: string;
  external_id: string;
  locale: Locale;
}

/**
 * Finds or creates the contact for an address. `channel` is part of the key so an SMS
 * sender (identified by phone) and a web tester (identified by cookie) coexist without
 * a schema change when Twilio arrives.
 */
export async function upsertContact(
  channel: string,
  externalId: string,
  locale: Locale,
  phone: string | null = null,
  tx?: PoolClient,
): Promise<Contact> {
  const sql = `
    INSERT INTO contacts (channel, external_id, locale, phone_e164)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (channel, external_id)
      DO UPDATE SET locale = EXCLUDED.locale
    RETURNING id, channel, external_id, locale
  `;
  const params = [channel, externalId, locale, phone];
  const rows = tx
    ? ((await tx.query(sql, params)).rows as ContactRow[])
    : await query<ContactRow>(sql, params);
  const r = rows[0];
  return { id: r.id, channel: r.channel, externalId: r.external_id, locale: r.locale };
}
