import { query } from '../client';
import { parseSessionState } from '@/lib/conversation/state-schema';
import type { SessionState } from '@/lib/conversation/types';
import { initialState } from '@/lib/conversation/types';

export interface Session {
  id: string;
  state: SessionState;
  version: number;
  contactId: string | null;
  /** True when stored state failed validation and was reset (see parseSessionState). */
  wasReset: boolean;
}

export interface StoredMessage {
  direction: 'inbound' | 'outbound';
  body: string;
  seq: number;
}

export async function getOrCreateSession(channel: string, externalId: string): Promise<Session> {
  const rows = await query<{ id: string; state: unknown; version: number; contact_id: string | null }>(
    `INSERT INTO conversation_sessions (channel, external_id, state)
     VALUES ($1, $2, $3)
     ON CONFLICT (channel, external_id) DO UPDATE SET updated_at = now()
     RETURNING id, state, version, contact_id`,
    [channel, externalId, JSON.stringify(initialState())],
  );
  const row = rows[0];
  const { state, reset } = parseSessionState(row.state);
  return { id: row.id, state, version: row.version, contactId: row.contact_id, wasReset: reset };
}

/**
 * Persists state, but only if nobody else wrote first.
 *
 * Returns false on a lost race. People double-send texts, and two lambdas processing the
 * same conversation concurrently would otherwise interleave and corrupt the flow — better to
 * drop the later write than to half-apply it.
 */
export async function saveSession(
  id: string,
  state: SessionState,
  expectedVersion: number,
  contactId?: string | null,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE conversation_sessions
        SET state = $1, version = version + 1, updated_at = now(),
            contact_id = COALESCE($4, contact_id)
      WHERE id = $2 AND version = $3
      RETURNING id`,
    [JSON.stringify(state), id, expectedVersion, contactId ?? null],
  );
  return rows.length > 0;
}

export async function appendMessages(
  sessionId: string,
  msgs: { direction: 'inbound' | 'outbound'; body: string }[],
): Promise<void> {
  if (msgs.length === 0) return;
  // seq comes from a single atomic subselect per insert rather than a read-then-write,
  // so concurrent appends can't collide on the same number.
  for (const m of msgs) {
    await query(
      `INSERT INTO messages (session_id, direction, body, seq)
       SELECT $1, $2, $3, COALESCE(MAX(seq), 0) + 1 FROM messages WHERE session_id = $1`,
      [sessionId, m.direction, m.body],
    );
  }
}

export async function listMessages(sessionId: string): Promise<StoredMessage[]> {
  // Ordered by seq, never created_at — same-millisecond inserts would otherwise shuffle.
  return query<StoredMessage & Record<string, unknown>>(
    `SELECT direction, body, seq FROM messages WHERE session_id = $1 ORDER BY seq`,
    [sessionId],
  );
}

export async function resetSession(channel: string, externalId: string): Promise<void> {
  await query(`DELETE FROM conversation_sessions WHERE channel = $1 AND external_id = $2`, [
    channel,
    externalId,
  ]);
}
