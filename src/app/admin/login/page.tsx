import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentAdmin } from '@/lib/auth/dal';
import { ADMIN_PATH } from '@/lib/auth/cookie';
import { LoginForm } from './login-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Staff sign-in',
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  if (await currentAdmin()) redirect(ADMIN_PATH);

  return (
    <main className="flex flex-1 items-center justify-center bg-neutral-100 p-4 dark:bg-black">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-lg font-semibold">Staff sign-in</h1>
        <p className="mb-5 mt-1 text-sm text-neutral-500">
          The pickup roster holds household phone numbers and dietary needs. Staff accounts only.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
