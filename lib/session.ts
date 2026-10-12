import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { currentFriday } from '@/lib/dates';
import { getDb } from '@/lib/db';
import type { Member } from '@/lib/db/schema';
import { canManageGroup } from '@/lib/permissions';
import { hostIdFor } from '@/lib/services/fridays';
import { SESSION_DAYS, findMemberBySession } from '@/lib/services/auth';
import { appUrl } from '@/lib/auth-tokens';

export const SESSION_COOKIE = 'futtarns_session';

export const getViewer = cache(async (): Promise<Member | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findMemberBySession(await getDb(), token);
});

export async function requireViewer(): Promise<Member> {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  return viewer;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: appUrl().startsWith('https:'),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  };
}

export type GroupContext = {
  viewer: Member;
  currentFriday: string;
  currentHostId: number | null;
  canManage: boolean;
  /** The request's clock reading, so every part of a page counts from the same moment. */
  now: number;
};

/** The viewer plus what decides their rights this week: who hosts the coming Friday. */
export const getGroupContext = cache(async (): Promise<GroupContext> => {
  const viewer = await requireViewer();
  const now = Date.now();
  const friday = currentFriday(new Date(now));
  const currentHostId = await hostIdFor(await getDb(), friday);
  return {
    viewer,
    currentFriday: friday,
    currentHostId,
    canManage: canManageGroup(viewer, currentHostId),
    now,
  };
});
