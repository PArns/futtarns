import { appUrl } from '@/lib/auth-tokens';
import { addWeeks, currentFriday, deliveryTime, orderDeadline } from '@/lib/dates';
import { getDb } from '@/lib/db';
import { formatTime } from '@/lib/format';
import { buildCalendar } from '@/lib/ical';
import { loadCalendar } from '@/lib/services/fridays';
import { findMemberByCalendarToken } from '@/lib/services/members';

const EVENING_HOURS = 4;

/** The member's calendar feed: the coming Fridays with host, restaurant and cancellations. */
export async function GET(_request: Request, context: RouteContext<'/ics/[file]'>) {
  const { file } = await context.params;
  const token = file.replace(/\.ics$/, '');
  const db = await getDb();
  const member = await findMemberByCalendarToken(db, token);
  if (!member) return new Response('Not found', { status: 404 });

  const now = new Date();
  const entries = await loadCalendar(db, addWeeks(currentFriday(now), -4), 30);
  const events = entries.map((entry) => {
    const start = orderDeadline(entry.date);
    const away = entry.absentMemberIds.includes(member.id);
    const hosting = entry.host?.id === member.id;
    const summary = entry.cancelled
      ? 'Freitach fällt aus'
      : `Freitach${entry.restaurant ? `: ${entry.restaurant.name}` : ''}${hosting ? ' (du bist Gastgeber)' : ''}`;
    const description = [
      entry.cancelled && entry.cancelReason ? entry.cancelReason : null,
      entry.host ? `Gastgeber: ${entry.host.name}` : null,
      `Bestellschluss ${formatTime(start)}, Essen ca. ${formatTime(deliveryTime(entry.date))}`,
      away ? 'Du bist als abwesend eingetragen.' : null,
    ]
      .filter(Boolean)
      .join('\n');
    return {
      uid: `friday-${entry.date}@freitach`,
      start,
      end: new Date(start.getTime() + EVENING_HOURS * 3_600_000),
      summary,
      description,
      url: `${appUrl()}/freitag/${entry.date}`,
      cancelled: entry.cancelled,
    };
  });

  return new Response(buildCalendar('freitach', events, now), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=900',
    },
  });
}
