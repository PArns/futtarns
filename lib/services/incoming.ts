import { and, eq } from 'drizzle-orm';
import { appUrl } from '@/lib/auth-tokens';
import { HELP_TEXT, parseCommand } from '@/lib/commands';
import { currentFriday, isPastDeadline } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import { members } from '@/lib/db/schema';
import { formatDayShort, formatEuro, formatTime } from '@/lib/format';
import { bold, loginCodeText } from '@/lib/messages';
import { requestLoginCode } from '@/lib/services/auth';
import {
  loadFriday,
  openBalancesFor,
  paymentOpen,
  recordPayment,
  setAttendance,
  type FridayView,
} from '@/lib/services/fridays';
import { ServiceError } from '@/lib/services/members';
import { orderUsual } from '@/lib/services/orders';
import { sendWhatsApp } from '@/lib/whatsapp';

const ANSWER_REPLY = {
  in: 'Alles klar, du bist dabei.',
  nofood: 'Alles klar, du kommst, isst aber nichts mit.',
  out: 'Schade! Du bist für Freitag raus.',
} as const;

const STATUS_LINE = {
  in: 'Du bist dabei.',
  nofood: 'Du kommst ohne Essen.',
  out: 'Du bist raus.',
} as const;

/** The order list for the bot's „andere“: who eats what, one line per person. */
function othersText(view: FridayView): string {
  const what =
    view.mode === 'flat'
      ? (view.flatTitle ?? 'Pauschale')
      : (view.restaurant?.name ?? 'Restaurant noch offen');
  const lines = view.participants
    .filter((entry) => entry.attendance.status !== 'out')
    .map((entry) => {
      const items = entry.items.map((item) => {
        const options = item.options.map((option) => option.choiceName).join(', ');
        return `${item.quantity > 1 ? `${item.quantity}× ` : ''}${item.name}${options ? ` (${options})` : ''}`;
      });
      const plate =
        entry.attendance.status === 'nofood'
          ? 'ohne Essen'
          : items.length
            ? items.join(', ')
            : view.mode === 'flat'
              ? 'dabei'
              : 'noch nichts';
      return `${bold(entry.member.name)}: ${plate}`;
    });
  return [bold(`Freitag (${formatDayShort(view.date)}): ${what}`), '', ...lines].join('\n');
}

/** Answers a WhatsApp command from a member; strangers and plain chat get no reply. */
export async function handleIncoming(
  db: Db,
  phone: string,
  text: string,
  now: Date,
  send: (to: string, text: string) => Promise<unknown> = sendWhatsApp
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
        return `Bestellschluss war um ${bold(formatTime(view.deadline))}. Sag ${view.host?.name ?? 'dem Gastgeber'} bitte direkt Bescheid.`;
      }
      const mine = view.participants.find((entry) => entry.member.id === member.id);
      if (command.status !== 'in' && mine?.items.length && !command.confirmed) {
        const answer = command.status === 'out' ? '3' : '2';
        return `Du hast schon ${bold(mine.items.map((item) => item.name).join(', '))} bestellt.\nWenn das weg soll, antworte mit ${bold(`${answer} sicher`)}.`;
      }
      await setAttendance(db, date, member.id, command.status);
      const order =
        command.status === 'in' && view.mode === 'delivery'
          ? view.restaurant
            ? `\n\nJetzt noch bei ${bold(view.restaurant.name)} aussuchen, oder ${bold('wie immer')} schreiben:\n${link}`
            : `\n\nDas Restaurant kommt noch, ich sag Bescheid.`
          : command.status === 'in' && view.mode === 'flat'
            ? `\n\n${bold(view.flatTitle ?? 'Pauschale')}: ${formatEuro(view.flatPriceCents ?? 0)} pro Person.\nBezahlt wird nach dem Anmeldeschluss:\n${link}`
            : '';
      return `${ANSWER_REPLY[command.status]}${order}`;
    }

    case 'usual': {
      const view = await loadFriday(db, date, now);
      if (view.cancelled) return `Freitag (${formatDayShort(date)}) fällt aus.`;
      if (view.locked || isPastDeadline(date, now)) {
        return `Bestellschluss war um ${bold(formatTime(view.deadline))}. Sag ${view.host?.name ?? 'dem Gastgeber'} bitte direkt Bescheid.`;
      }
      if (view.mode === 'flat') {
        await setAttendance(db, date, member.id, 'in');
        return `Alles klar, du bist dabei: ${bold(view.flatTitle ?? 'Pauschale')}.`;
      }
      if (!view.restaurant) return 'Das Restaurant steht noch nicht fest, ich sag Bescheid.';
      const mine = view.participants.find((entry) => entry.member.id === member.id);
      if (mine?.items.length) {
        return `Du hast schon ${bold(mine.items.map((item) => item.name).join(', '))} bestellt. Passt!`;
      }
      const usual = await orderUsual(db, date, member.id, view.restaurant.id);
      if (!usual) {
        return `Bei ${bold(view.restaurant.name)} hast du noch keinen Standard. Such dir was aus:\n${link}`;
      }
      return 'dish' in usual
        ? `Alles klar: ${bold(usual.dish)} wie immer. Du bist dabei.`
        : 'Alles klar, wie immer: du kommst, isst aber nichts mit.';
    }

    case 'others': {
      const view = await loadFriday(db, date, now);
      if (view.cancelled) return `Freitag (${formatDayShort(date)}) fällt aus.`;
      return `${othersText(view)}\n\n${link}`;
    }

    case 'paid': {
      const view = await loadFriday(db, date, now);
      const current = view.participants.find((entry) => entry.member.id === member.id);
      const payable = paymentOpen(view, now);
      const open = [
        ...(payable && current
          ? current.money.debts.map((debt) => ({ fridayDate: date, debt }))
          : []),
        ...(await openBalancesFor(db, member.id, date, now)).map((balance) => ({
          fridayDate: balance.fridayDate,
          debt: balance.debt,
        })),
      ].filter((entry) => entry.debt.openCents > 0);
      if (open.length === 0) {
        return !payable && current && current.money.openCents > 0
          ? `Bezahlt wird erst nach dem Bestellschluss um ${bold(formatTime(view.deadline))}, dann steht fest, was du zahlst. Ich schick dir den Betrag.`
          : 'Bei dir ist gerade nichts offen. Danke trotzdem!';
      }
      for (const { fridayDate, debt } of open) {
        await recordPayment(db, {
          date: fridayDate,
          memberId: member.id,
          amountCents: debt.openCents,
          recordedById: member.id,
          payeeId: debt.payeeId,
        });
      }
      const total = open.reduce((sum, entry) => sum + entry.debt.openCents, 0);
      return `Danke! ${bold(formatEuro(total))} sind als bezahlt vermerkt.`;
    }

    case 'login': {
      // The code goes straight to the member's own number, never back in the HTTP answer,
      // so knowing the webhook's token is not enough to sign in as someone.
      try {
        const issued = await requestLoginCode(db, phone, now);
        if (!issued) return null;
        const { code } = issued;
        await send(
          phone,
          loginCodeText(code, `${appUrl()}/login?phone=${encodeURIComponent(phone)}&code=${code}`)
        );
        return null;
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
      const status = me ? STATUS_LINE[me.attendance.status] : '';
      const items = me?.items.length
        ? `\nBestellt: ${bold(me.items.map((item) => item.name).join(', '))}`
        : '';
      const money =
        me && me.money.openCents > 0 ? `\nOffen: ${bold(formatEuro(me.money.openCents))}` : '';
      return `${bold(`Freitag (${formatDayShort(date)})`)} bei ${view.host?.name ?? '?'}: ${bold(what)}\n${status}${items}${money}\n${link}`;
    }

    case 'help':
      return HELP_TEXT;

    default:
      // The bot may share someone's own number, so ordinary chat gets no reply.
      return null;
  }
}
