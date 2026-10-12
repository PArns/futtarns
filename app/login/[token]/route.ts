import { NextResponse } from 'next/server';
import { appUrl } from '@/lib/auth-tokens';
import { getDb } from '@/lib/db';
import { createSession } from '@/lib/services/auth';
import { findMemberByLoginToken } from '@/lib/services/members';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';

/** The personal link: signs the member in on this device and drops them on the start page. */
export async function GET(_request: Request, context: RouteContext<'/login/[token]'>) {
  const { token } = await context.params;
  const db = await getDb();
  const member = await findMemberByLoginToken(db, token);
  // Behind the reverse proxy the request's own origin is the container's, not the site's.
  const response = NextResponse.redirect(new URL(member ? '/' : '/login?link=invalid', appUrl()));
  if (member)
    response.cookies.set(
      SESSION_COOKIE,
      await createSession(db, member.id),
      sessionCookieOptions()
    );
  return response;
}
