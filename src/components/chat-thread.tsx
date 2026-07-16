'use client';

import { useEffect, useRef, useState } from 'react';

interface Message {
  direction: 'inbound' | 'outbound';
  body: string;
  seq: number;
}

export function ChatThread() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/chat')
      .then((r) => r.json())
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => setError('Could not reach the food bank service.'));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function send(text: string) {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    setDraft('');
    // Show the sent bubble immediately; the server's copy replaces it on response.
    setMessages((m) => [...m, { direction: 'inbound', body, seq: -1 }]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch {
      setError('Message failed to send.');
      setMessages((m) => m.filter((x) => x.seq !== -1));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function reset() {
    setBusy(true);
    const res = await fetch('/api/chat', { method: 'DELETE' });
    const data = await res.json();
    setMessages(data.messages ?? []);
    setBusy(false);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[2.25rem] border border-neutral-300 bg-neutral-50 shadow-2xl dark:border-neutral-700 dark:bg-neutral-950">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white/80 px-5 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-base">
            🥕
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Food Bank
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Pickup sign-up
            </p>
          </div>
        </div>
        <button
          onClick={reset}
          disabled={busy}
          className="rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          New thread
        </button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <Bubble key={`${m.seq}-${i}`} message={m} />
        ))}
        {busy && <Typing />}
        {error && (
          <p className="py-2 text-center text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="flex items-center gap-2 border-t border-neutral-200 bg-white px-3 py-3 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Text message"
          maxLength={500}
          autoFocus
          className="flex-1 rounded-full border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm text-neutral-900 outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-30"
          aria-label="Send"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
          </svg>
        </button>
      </form>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  // "inbound" is inbound to the food bank, i.e. sent BY the person using this page — so it
  // renders on the right, the way your own texts do.
  const mine = message.direction === 'inbound';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed ${
          mine
            ? 'rounded-br-md bg-blue-600 text-white'
            : 'rounded-bl-md bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
        }`}
      >
        {message.body}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex justify-start">
      <div className="flex gap-1 rounded-2xl rounded-bl-md bg-neutral-200 px-4 py-3 dark:bg-neutral-800">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
