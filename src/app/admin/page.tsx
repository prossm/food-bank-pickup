import Link from 'next/link';
import { slotRoster } from '@/lib/db/repos/slots';
import { bookedPickups } from '@/lib/db/repos/roster';
import { FOOD_BANK_TZ } from '@/lib/i18n/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const [roster, rows] = await Promise.all([slotRoster(), bookedPickups()]);
  const upcoming = roster.filter((s) => s.startsAt > new Date());

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pickup roster</h1>
          <p className="text-sm text-neutral-500">Times shown in {FOOD_BANK_TZ}</p>
        </div>
        <Link href="/chat" className="text-sm text-emerald-700 underline dark:text-emerald-500">
          Back to chat
        </Link>
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
              <tr key={r.code} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="whitespace-nowrap px-3 py-2">{fmt(r.startsAt)}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                <td className="px-3 py-2">
                  {r.role === 'ambassador' ? '🚗 Ambassador' : '🏠 Family'}
                </td>
                <td className="px-3 py-2">
                  <span className="font-medium">{r.families}</span>{' '}
                  <span className="text-neutral-500">{r.householdNames}</span>
                </td>
                <td className="px-3 py-2">{r.people}</td>
                <td className="px-3 py-2">{r.boxes}</td>
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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </div>
  );
}
