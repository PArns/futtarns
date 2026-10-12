import { and, eq } from 'drizzle-orm';
import { appUrl } from '@/lib/auth-tokens';
import { HELP_TEXT, parseCommand } from '@/lib/commands';
import { currentFriday, isPastDeadline } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import { members } from '@/lib/db/schema';
import { formatDayShort, formatEuro, formatTime } from '@/lib/format';
import { requestLoginCode } from '@/lib/services/auth';
import { loadFriday, openBalancesFor, recordPayment, setAttendance } from '@/lib/services/fridays';
import { ServiceError } from '@/lib/services/members';

const ANSWER_REPLY = {
  in: 'Alles klar, du bist dabei.',
  nofood: 'Alles klar, du kommst, isst aber nichts mit.',
  out: 'Schade! Du bist für Freitag raus.',
} as const;

/** Answers a WhatsApp message from a member; strangers get no reply. */
export async function handleIncoming(
  db: Db,
  phone: string,
  text: string,
  now: Date
): Promise<string | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.phone, phone), eq(members.active, true), eq(members.kind, 'member')));
  if (!member) return null;

  const command = parseCommand(text);
  const date = currentFriday(now);
  const link = `${appUrl()}/freitag/${date}`;

  switch (command.kind) {
    case 'answer': {
      const view = await loadFriday(db, date, now);
      if (view.cancelled) return `Freitag (${formatDayShort(date)}) fällt aus.`;
      if (view.locked || isPastDeadline(date, now)) {
        return `Bestellschluss war um ${formatTime(view.deadline)}. Sag ${view.host?.name ?? 'dem Gastgeber'} bitte direkt Bescheid.`;
      }
      await setAttendance(db, date, member.id, command.status);
      const order =
        command.status === 'in' && view.mode === 'delivery'
          ? view.restaurant
            ? `\nJetzt noch bei ${view.restaurant.name} aussuchen und zahlen: ${link}`
            : `\nDas Restaurant kommt noch, ich sag Bescheid.`
          : command.status === 'in' && view.mode === 'flat'
            ? `\n${view.flatTitle ?? 'Pauschale'}: ${formatEuro(view.flatPriceCents ?? 0)}. Zahlen geht hier: ${link}`
            : '';
      return `${ANSWER_REPLY[command.status]}${order}`;
    }

    case 'paid': {
      const view = await loadFriday(db, date, now);
      const current = view.participants.find((entry) => entry.member.id === member.id);
      const open = [
        ...(current && current.money.openCents > 0
          ? [{ fridayDate: date, openCents: current.money.openCents }]
          : []),
        ...(await openBalancesFor(db, member.id, date, now))
          .filter((balance) => balance.money.openCents > 0)
          .map((balance) => ({
            fridayDate: balance.fridayDate,
            openCents: balance.money.openCents,
          })),
      ];
      if (open.length === 0) return 'Bei dir ist gerade nichts offen. Danke trotzdem!';
      for (const entry of open) {
        await recordPayment(db, {
          date: entry.fridayDate,
          memberId: member.id,
          amountCents: entry.openCents,
          purpose: 'food',
          recordedById: member.id,
        });
      }
      const total = open.reduce((sum, entry) => sum + entry.openCents, 0);
      return `Danke! ${formatEuro(total)} sind als bezahlt vermerkt.`;
    }

    case 'login': {
      try {
        const { code } = await requestLoginCode(db, phone, now);
        return `Dein Code für freitach: ${code}\nOder direkt anmelden: ${appUrl()}/login?phone=${encodeURIComponent(phone)}&code=${code}`;
      } catch (error) {
        if (error instanceof ServiceError) return error.message;
        throw error;
      }
    }

    case 'status': {
      const view = await loadFriday(db, date, now);
      if (view.cancelled) return `Freitag (${formatDayShort(date)}) fällt aus.`;
      const me = view.participants.find((entry) => entry.member.id === member.id);
      const what =
        view.mode === 'flat'
          ? `${view.flatTitle ?? 'Pauschale'} für ${formatEuro(view.flatPriceCents ?? 0)}`
          : (view.restaurant?.name ?? 'Restaurant noch offen');
      const status = me
        ? ANSWER_REPLY[me.attendance.status].replace('Alles klar, d', 'D').replace('Schade! ', '')
        : '';
      const items = me?.items.length
        ? `\nBestellt: ${me.items.map((item) => item.name).join(', ')}`
        : '';
      const money =
        me && me.money.openCents > 0 ? `\nOffen: ${formatEuro(me.money.openCents)}` : '';
      return `Freitag (${formatDayShort(date)}) bei ${view.host?.name ?? '?'}: ${what}.\n${status}${items}${money}\n${link}`;
    }

    case 'help':
      return HELP_TEXT;

    default:
      return `Das hab ich nicht verstanden.\n\n${HELP_TEXT}`;
  }
}
