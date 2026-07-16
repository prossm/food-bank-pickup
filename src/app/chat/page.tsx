import Link from 'next/link';
import { ChatThread } from '@/components/chat-thread';

export const dynamic = 'force-dynamic';

export default function ChatPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-neutral-100 p-4 dark:bg-black">
      <div className="h-[38rem] w-full max-w-md">
        <ChatThread />
      </div>
      <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
        Simulated text thread — this is what the SMS conversation will look like.{' '}
        <Link href="/admin" className="underline hover:text-neutral-700 dark:hover:text-neutral-200">
          Staff roster
        </Link>
      </p>
    </main>
  );
}
