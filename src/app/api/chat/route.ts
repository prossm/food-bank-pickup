import { NextResponse } from 'next/server';
import { z } from 'zod';
import { processInbound, startConversation } from '@/lib/conversation/runner';
import { resetSession } from '@/lib/db/repos/sessions';
import { SESSION_COOKIE } from '@/lib/session-key';
import type { Address } from '@/lib/transport/types';

// The pg driver needs a real Node runtime, and every request hits the database.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  text: z.string().min(1).max(500),
});

function addressFrom(req: Request): { address: Address; isNew: boolean } {
  const cookie = req.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === SESSION_COOKIE)?.[1];

  if (cookie) return { address: { channel: 'web', externalId: cookie }, isNew: false };
  return { address: { channel: 'web', externalId: crypto.randomUUID() }, isNew: true };
}

function withCookie(res: NextResponse, address: Address, isNew: boolean): NextResponse {
  if (isNew) {
    res.cookies.set(SESSION_COOKIE, address.externalId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return res;
}

/** Opens the thread and returns its history, sending the greeting on a brand new one. */
export async function GET(req: Request) {
  const { address, isNew } = addressFrom(req);
  const messages = await startConversation(address);
  return withCookie(NextResponse.json({ messages }), address, isNew);
}

export async function POST(req: Request) {
  const { address, isNew } = addressFrom(req);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected { text: string }' }, { status: 400 });
  }

  const { messages } = await processInbound(address, parsed.data.text);
  return withCookie(NextResponse.json({ messages }), address, isNew);
}

/** Wipes the thread — the "new tester" button, not a user-facing SMS action. */
export async function DELETE(req: Request) {
  const { address, isNew } = addressFrom(req);
  await resetSession(address.channel, address.externalId);
  const messages = await startConversation(address);
  return withCookie(NextResponse.json({ messages }), address, isNew);
}
