import type { Metadata } from 'next';
import Link from 'next/link';
import { slotRoster } from '@/lib/db/repos/slots';
import { bookedPickups } from '@/lib/db/repos/roster';
import { formatPhone } from '@/lib/domain/phone';
import { FOOD_BANK_TZ } from '@/lib/i18n/format';
import { requireAdmin } from '@/lib/auth/dal';
import { logout } from './actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

function fmt(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: FOOD_BANK_TZ,
  }).format(new Date(d));
}

export default async function AdminPage() {
  // Before the roster is read, not alongside it: requireAdmin() redirects a signed-out
  // visitor, and household phone numbers should never be fetched for one at all.
  const admin = await requireAdmin();

  const [roster, rows] = await Promise.all([slotRoster(), bookedPickups()]);
  const upcoming = roster.filter((s) => s.startsAt > new Date());

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pickup roster</h1>
          <p className="text-sm text-neutral-500">Times shown in {FOOD_BANK_TZ}</p>
        </div>
        <div className="flex items-baseline gap-4 text-sm">
          <span className="text-neutral-500">{admin.email}</span>
          <Link href="/chat" className="text-emerald-700 underline dark:text-emerald-500">
            Back to chat
          </Link>
          <form action={logout}>
            <button type="submit" className="text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <section className="mb-8 grid gap-3 sm:grid-cols-2">
        {upcoming.slice(0, 4).map((s) => (
          <div
            key={s.id}
            className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <p className="text-sm font-medium">{fmt(s.startsAt)}</p>
            <div className="mt-3 flex gap-6 text-sm">
              {/* Spots and people are deliberately shown as separate figures: one ambassador
                  is one car but many households, and staging food off the spot count would
                  under-order every week. */}
              <Stat label="Spots left" value={`${s.spotsLeft} / ${s.capacity}`} />
              <Stat label="Households" value={s.familiesServed} />
              <Stat label="People" value={s.peopleServed} />
            </div>
          </div>
        ))}
        {upcoming.length === 0 && (
          <p className="text-sm text-neutral-500">No upcoming slots. Run `npm run seed`.</p>
        )}
      </section>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Booked pickups
      </h2>
      <p className="mb-2 text-xs text-neutral-500">
        Households are identified by phone. Names are entered by staff — the sign-up never asks
        for them, since an ambassador knows the number, not the surname.
      </p>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-100 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
            <tr>
              {['Time', 'Code', 'Type', 'Households', 'People', 'Boxes', 'Restrictions'].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-t border-neutral-200 align-top dark:border-neutral-800">
                <td className="whitespace-nowrap px-3 py-2">{fmt(r.startsAt)}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.role === 'ambassador' ? '🚗 Ambassador' : '🏠 Family'}
                </td>
                <td className="px-3 py-2">
                  <ul className="space-y-1">
                    {r.households.map((h) => (
                      <li key={h.phone ?? h.name} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-mono text-xs">
                          {h.phone ? formatPhone(h.phone) : '(no phone)'}
                        </span>
                        {/* Names come from staff, never the chat — so most start blank. */}
                        <span className={h.name ? 'font-medium' : 'text-neutral-400 italic'}>
                          {h.name ?? 'unnamed'}
                        </span>
                        <span className="text-neutral-500">
                          {h.size}p · {h.boxes}box
                          {h.allergies.length > 0 && ` · ${h.allergies.join(', ').replaceAll('_', ' ')}`}
                        </span>
                        <StaleFlag at={h.sizeConfirmedAt} />
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-3 py-2 tabular-nums">{r.people}</td>
                <td className="px-3 py-2 tabular-nums">{r.boxes}</td>
                <td className="px-3 py-2 text-neutral-500">
                  {r.allergies ? r.allergies.replaceAll('_', ' ') : '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-neutral-500">
                  No sign-ups yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

/**
 * A recognised household reuses its stored size and is never re-asked, so a size can quietly
 * go stale for years — and a stale size means the wrong amount of food with nothing to signal
 * it. This is that signal.
 */
const STALE_AFTER_DAYS = 180;

function StaleFlag({ at }: { at: Date | null }) {
  if (!at) return null;
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (days < STALE_AFTER_DAYS) return null;
  return (
    <span
      className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300"
      title={`Household size last confirmed ${days} days ago`}
    >
      size {days}d old
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </div>
  );
}
