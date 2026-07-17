'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { equalizeVerifyTiming, verifyPassword } from '@/lib/auth/password';
import { endAdminSession, startAdminSession } from '@/lib/auth/session';
import { ADMIN_PATH, LOGIN_PATH } from '@/lib/auth/cookie';
import { findAdminByEmail, touchAdminLastLogin } from '@/lib/db/repos/admins';

export interface LoginState {
  error?: string;
}

/**
 * One message for every failure — unknown address, wrong password, malformed input alike.
 * Anything more specific tells a stranger which staff addresses exist.
 */
const INVALID = 'Wrong email or password.';

const LoginSchema = z.object({
  email: z.string().trim().min(3).max(254),
  // Bounded so an enormous body can't be pushed through scrypt. No minimum and no complexity
  // rules: this form checks an existing password, and rejecting a short one here would only
  // reveal that the rules were once different.
  password: z.string().min(1).max(1024),
});

export async function login(_prev: LoginState | undefined, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: INVALID };

  const { email, password } = parsed.data;
  const admin = await findAdminByEmail(email);

  if (!admin) {
    await equalizeVerifyTiming(password);
    return { error: INVALID };
  }
  if (!(await verifyPassword(password, admin.passwordHash))) {
    return { error: INVALID };
  }

  await startAdminSession(admin.id);
  await touchAdminLastLogin(admin.id);

  // Throws NEXT_REDIRECT, so it must stay outside any try/catch.
  redirect(ADMIN_PATH);
}

export async function logout(): Promise<void> {
  await endAdminSession();
  redirect(LOGIN_PATH);
}
