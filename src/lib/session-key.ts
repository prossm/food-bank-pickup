import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'fb_thread';

/**
 * Identifies a web tester the way a phone number identifies an SMS sender.
 *
 * Deliberately not authentication — it's the web transport's stand-in for "which phone is
 * this", so each browser gets its own thread and testers don't stomp on each other.
 */
export async function threadId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing) return existing;
  return crypto.randomUUID();
}

export async function readThreadId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}
