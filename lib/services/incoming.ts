import { and, eq } from 'drizzle-orm';
import { appUrl } from '@/lib/auth-tokens';
import { HELP_TEXT, parseCommand } from '@/lib/commands';
import { currentFriday, isPastDeadline } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import { members, type AttendanceStatus, type OrderItem } from '@/lib/db/schema';
import { formatDayShort, formatEuro, formatTime } from '@/lib/format';
import { bold, loginCodeText } from '@/lib/messages';
import { requestLoginCode } from '@/lib/services/auth';
import {
  castVote,
  loadFriday,
  openBalancesFor,
  paymentOpen,
  recordPayment,
  setAttendance,
  setLate,
  takeOverFriday,
  type FridayView,
} from '@/lib/services/fridays';
import { ServiceError } from '@/lib/services/members';
import { getDefault, orderSame, orderUsual } from '@/lib/services/orders';
import { restaurantsForHost } from '@/lib/services/restaurants';
import { optionForLetter, standings, voteEndsText, voteLetter, votingAt } from '@/lib/vote';
import { sendWhatsApp } from '@/lib/whatsapp';

/** The vote while it runs, with the names of the restaurants on its ballot. */
async function runningVote(db: Db, view: FridayView, now: Date) {
  if (view.mode !== 'delivery') return null;
  const options = await restaurantsForHost(db, view.host?.id ?? null);
  if (!votingAt(view, now) || options.length < 2) return null;
  return {
    nameOf: (restaurantId: number) =>
      options.find((option) => option.id === restaurantId)?.name ?? 'anderes Restaurant',
  };
}

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

/** One person's dishes in a line: `2× Margherita (Groß), Tiramisu`. */
function dishesLine(items: OrderItem[]): string {
  return items
    .map((item) => {
      const options = item.options.map((option) => option.choiceName).join(', ');
      return `${item.quantity > 1 ? `${item.quantity}× ` : ''}${item.name}${options ? ` (${options})` : ''}`;
    })
    .join(', ');
}

/**
 * The order list for the bot's „andere“: who eats what, one line per person. While the
 * vote runs, `ahead` names the restaurants people ordered ahead from.
 */
function othersText(view: FridayView, ahead: ((restaurantId: number) => string) | null): string {
  const what =
    view.mode === 'flat'
      ? (view.flatTitle ?? 'Pauschale')
      : view.restaurant
        ? `${view.restaurant.name}${ahead ? ' (Wahl läuft noch)' : ''}`
        : 'Restaurant noch offen';
  const lines = view.participants
    .filter((entry) => entry.attendance.status !== 'out')
    .map((entry) => {
      const plate =
        entry.attendance.status === 'nofood'
          ? 'ohne Essen'
          : entry.items.length
            ? dishesLine(entry.items)
            : view.mode === 'flat'
              ? 'dabei'
              : 'noch nichts';
      const preorders = ahead
        ? [
            ...Map.groupBy(
              view.preorders.filter((item) => item.memberId === entry.member.id),
              (item) => item.restaurantId
            ),
          ].map(
            ([restaurantId, items]) =>
              ` · falls ${ahead(restaurantId)} gewinnt: ${dishesLine(items)}`
          )
        : [];
      return `${bold(entry.member.name)}: ${plate}${preorders.join('')}`;
    });
  return [bold(`Freitag (${formatDayShort(view.date)}): ${what}`), '', ...lines].join('\n');
}

/**
 * Records whether someone comes, unless the Friday is off, past its deadline or the answer
 * would throw away an order without „sicher“ (`again` is what to send to confirm).
 */
async function answer(
  db: Db,
  memberId: number,
  status: AttendanceStatus,
  confirmed: boolean,
  now: Date,
  again = `${status === 'out' ? '3' : '2'} sicher`
): Promise<{ ok: true; reply: string; view: FridayView } | { ok: false; reply: string }> {
  const date = currentFriday(now);
  const view = await loadFriday(db, date, now);
  if (view.cancelled) return { ok: false, reply: `Freitag (${formatDayShort(date)}) fällt aus.` };
  if (view.locked || isPastDeadline(date, now)) {
    return {
      ok: false,
      reply: `Bestellschluss war um ${bold(formatTime(view.deadline))}. Sag ${view.host?.name ?? 'dem Gastgeber'} bitte direkt Bescheid.`,
    };
  }
  const mine = view.participants.find((entry) => entry.member.id === memberId);
  if (status !== 'in' && mine?.items.length && !confirmed) {
    return {
      ok: false,
      reply: `Du hast schon ${bold(mine.items.map((item) => item.name).join(', '))} bestellt.\nWenn das weg soll, antworte mit ${bold(again)}.`,
    };
  }
  await setAttendance(db, date, memberId, status, now);
  return { ok: true, reply: ANSWER_REPLY[status], view };
}

/** Casts a vote for the restaurant behind a ballot letter, and says where the vote stands. */
async function vote(db: Db, memberId: number, letter: string, now: Date): Promise<string> {
  const date = currentFriday(now);
  const link = `${appUrl()}/freitag/${date}`;
  const view = await loadFriday(db, date, now);
  const options = await restaurantsForHost(db, view.host?.id ?? null);
  if (!votingAt(view, now) || options.length < 2) {
    return view.restaurant && view.mode === 'delivery' && !view.cancelled
      ? `Gerade läuft keine Restaurantwahl. Freitag gibt's ${bold(view.restaurant.name)}. 🍽️`
      : 'Gerade läuft keine Restaurantwahl.';
  }
  const option = optionForLetter(options, letter);
  if (!option) {
    return [
      'Den Buchstaben gibt’s nicht. Zur Wahl stehen:',
      ...options.map((entry, index) => `${bold(voteLetter(index))} · ${entry.name}`),
    ].join('\n');
  }
  let cast: Awaited<ReturnType<typeof castVote>>;
  try {
    cast = await castVote(db, date, memberId, option.id, now);
  } catch (error) {
    if (error instanceof ServiceError) return error.message;
    throw error;
  }
  const after = await loadFriday(db, date, now);
  const nameOf = (id: number) =>
    after.participants.find((entry) => entry.member.id === id)?.member.name ?? '?';
  // A vote is a yes; without a dish from there, their default there is what they get,
  // unless they come without food.
  const eats =
    after.participants.find((entry) => entry.member.id === memberId)?.attendance.status === 'in';
  const usual = eats ? (await getDefault(db, memberId, option.id))?.dish : null;
  const orderedThere = [
    ...after.participants.flatMap((entry) => entry.items),
    ...after.preorders,
  ].some((item) => item.memberId === memberId && item.restaurantId === option.id);
  return [
    `🗳️ Stimme gezählt: ${bold(option.name)}!`,
    ...(cast.joined ? ['Damit bist du am Freitag dabei.'] : []),
    ...(usual && !orderedThere
      ? [`Sagst du nichts anderes, bekommst du dort deinen Standard (${bold(usual.name)}).`]
      : []),
    ...(cast.dropped ? ['Deine Vorbestellung beim anderen Restaurant ist damit raus.'] : []),
    ...(option.id !== after.restaurant?.id
      ? [
          `Auf der Seite kannst du bei ${option.name} schon vorbestellen, das zählt, wenn es gewinnt.`,
        ]
      : []),
    '',
    bold('Stand:'),
    ...standings(options, after.votes, nameOf),
    '',
    `Umentscheiden geht bis ${bold(voteEndsText(date, now))}, einfach einen anderen Buchstaben schicken.`,
    link,
  ].join('\n');
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
      const answered = await answer(db, member.id, command.status, command.confirmed, now);
      if (!answered.ok) return answered.reply;
      const view = answered.view;
      const order =
        command.status === 'in' && view.mode === 'delivery'
          ? view.restaurant
            ? `\n\nJetzt noch bei ${bold(view.restaurant.name)} aussuchen, oder ${bold('wie immer')} schreiben:\n${link}`
            : `\n\nDas Restaurant kommt noch, ich sag Bescheid.`
          : command.status === 'in' && view.mode === 'flat'
            ? `\n\n${bold(view.flatTitle ?? 'Pauschale')}: ${formatEuro(view.flatPriceCents ?? 0)} pro Person.\nBezahlt wird nach dem Anmeldeschluss:\n${link}`
            : '';
      return `${answered.reply}${order}`;
    }

    case 'answerVote': {
      // „1E“: the answer first, then the vote; while no vote runs, the answer still counts.
      const again = `${command.status === 'in' ? '1' : '2'}${command.letter.toUpperCase()} sicher`;
      const answered = await answer(db, member.id, command.status, command.confirmed, now, again);
      if (!answered.ok) return answered.reply;
      return `${answered.reply}\n\n${await vote(db, member.id, command.letter, now)}`;
    }

    case 'takeOver': {
      try {
        await takeOverFriday(db, date, member.id, now);
      } catch (error) {
        if (error instanceof ServiceError) {
          const view = await loadFriday(db, date, now);
          return view.host && !view.hostAbsent
            ? `Freitag (${formatDayShort(date)}) ist schon ${view.host.id === member.id ? 'bei dir' : `bei ${bold(view.host.name)}`}. 🏠`
            : `${error.message}.`;
        }
        throw error;
      }
      return `🏠 Danke! Freitag (${formatDayShort(date)}) ist jetzt ${bold('bei dir')}: Du bestellst, und das Geld geht an dich.\n${link}`;
    }

    case 'usual': {
      const view = await loadFriday(db, date, now);
      if (view.cancelled) return `Freitag (${formatDayShort(date)}) fällt aus.`;
      if (view.locked || isPastDeadline(date, now)) {
        return `Bestellschluss war um ${bold(formatTime(view.deadline))}. Sag ${view.host?.name ?? 'dem Gastgeber'} bitte direkt Bescheid.`;
      }
      if (view.mode === 'flat') {
        await setAttendance(db, date, member.id, 'in', now);
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

    case 'same': {
      const view = await loadFriday(db, date, now);
      if (view.cancelled) return `Freitag (${formatDayShort(date)}) fällt aus.`;
      if (view.locked || isPastDeadline(date, now)) {
        return `Bestellschluss war um ${bold(formatTime(view.deadline))}. Sag ${view.host?.name ?? 'dem Gastgeber'} bitte direkt Bescheid.`;
      }
      if (view.mode === 'flat') {
        return `Diesmal gibt's ${bold(view.flatTitle ?? 'eine Pauschale')}, da gibt es nichts zu bestellen. Mit ${bold('1')} bist du dabei.`;
      }
      if (!view.restaurant) return 'Das Restaurant steht noch nicht fest, ich sag Bescheid.';
      const mine = view.participants.find((entry) => entry.member.id === member.id);
      if (mine?.items.length) {
        return `Du hast schon ${bold(mine.items.map((item) => item.name).join(', '))} bestellt. Passt!`;
      }
      const same = await orderSame(db, date, member.id, view.restaurant.id, now);
      if (!same) {
        return `Bei ${bold(view.restaurant.name)} hast du noch nie bestellt. Such dir was aus:\n${link}`;
      }
      const gone = same.gone.length ? `Nicht mehr auf der Karte: ${same.gone.join(', ')}.` : '';
      if (same.ordered.length === 0) {
        return `${gone} Such dir bitte was Neues aus:\n${link}`;
      }
      return [
        `👍 Alles klar, wie am ${formatDayShort(same.date)}: ${bold(same.ordered.join(', '))}. Du bist dabei.`,
        ...(gone ? [gone] : []),
      ].join('\n');
    }

    case 'late': {
      const view = await loadFriday(db, date, now);
      if (view.cancelled) return `Freitag (${formatDayShort(date)}) fällt aus.`;
      if (view.settled) return `Freitag (${formatDayShort(date)}) ist schon abgerechnet.`;
      await setLate(db, date, member.id, true, command.arrivesAt, now);
      const after = await loadFriday(db, date, now);
      const mine = after.participants.find((entry) => entry.member.id === member.id);
      const when = command.arrivesAt ? `gegen ${bold(command.arrivesAt)}` : 'später';
      const host = after.host?.name ?? 'der Gastgeber';
      // Whoever comes later still picks by the deadline; their dish goes on the later list.
      const food =
        after.mode !== 'delivery' || mine?.attendance.status !== 'in'
          ? ''
          : mine.items.length
            ? `\nDein ${bold(mine.items.map((item) => item.name).join(', '))} kommt auf die Später-Liste, ${host} bestellt es dann für später.`
            : after.locked || isPastDeadline(date, now)
              ? `\nAussuchen geht nicht mehr, sag ${host} direkt, was du willst.`
              : `\nSuch dir bis ${bold(formatTime(after.deadline))} trotzdem was aus, ${host} bestellt es dann für später:\n${link}`;
      return `🕘 Alles klar, du kommst ${when}.${food}`;
    }

    case 'onTime': {
      await setLate(db, date, member.id, false, null, now);
      return '⏰ Alles klar, du bist pünktlich da.';
    }

    case 'others': {
      const view = await loadFriday(db, date, now);
      if (view.cancelled) return `Freitag (${formatDayShort(date)}) fällt aus.`;
      const vote = await runningVote(db, view, now);
      return `${othersText(view, vote && ((id) => vote.nameOf(id)))}\n\n${link}`;
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
          ? `Bezahlt wird erst, wenn ${view.host?.name ?? 'der Gastgeber'} die Zahlung freigibt, dann steht fest, was du zahlst.`
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
      const status = me
        ? `${STATUS_LINE[me.attendance.status]}${me.late ? `\n🕘 Du kommst später${me.arrivesAt ? ` (gegen ${me.arrivesAt})` : ''}.` : ''}`
        : '';
      const items = me?.items.length
        ? `\nBestellt: ${bold(me.items.map((item) => item.name).join(', '))}`
        : '';
      const vote = await runningVote(db, view, now);
      const myVote = view.votes.find((entry) => entry.memberId === member.id)?.restaurantId;
      const ahead = vote
        ? [
            ...Map.groupBy(
              view.preorders.filter((item) => item.memberId === member.id),
              (item) => item.restaurantId
            ),
          ].map(
            ([restaurantId, list]) =>
              `\nVorbestellt bei ${vote.nameOf(restaurantId)}: ${bold(list.map((item) => item.name).join(', '))}`
          )
        : [];
      const voting = vote
        ? `\n🗳️ Die Restaurantwahl läuft bis ${bold(voteEndsText(date, now))}, ${
            myVote ? `deine Stimme: ${bold(vote.nameOf(myVote))}` : 'deine Stimme fehlt noch'
          }.`
        : '';
      const money =
        me && me.money.openCents > 0 ? `\nOffen: ${bold(formatEuro(me.money.openCents))}` : '';
      return `${bold(`Freitag (${formatDayShort(date)})`)} bei ${view.host?.name ?? '?'}: ${bold(what)}${vote ? ' (Stand jetzt)' : ''}\n${status}${items}${ahead.join('')}${voting}${money}\n${link}`;
    }

    case 'vote':
      return vote(db, member.id, command.letter, now);

    case 'help':
      return HELP_TEXT;

    default:
      // The bot may share someone's own number, so ordinary chat gets no reply.
      return null;
  }
}
