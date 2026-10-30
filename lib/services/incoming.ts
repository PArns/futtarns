import { and, eq } from 'drizzle-orm';
import { appUrl } from '@/lib/auth-tokens';
import {
  ASSISTANT_BUDGET_MS,
  claudeInterpreter,
  completeSelection,
  ERROR_REPLY,
  DailyLimit,
  LIMIT_TEXT,
  understand,
  type Interpretation,
  type Interpreter,
} from '@/lib/assistant';
import { HELP_TEXT, parseCommand, type Command } from '@/lib/commands';
import { currentFriday, daysBetween, isPastDeadline, todayIso } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import {
  dishes,
  members,
  type AttendanceStatus,
  type Member,
  type OrderItem,
} from '@/lib/db/schema';
import { formatDayList, formatDayShort, formatEuro, formatTime } from '@/lib/format';
import { bold, loginCodeText } from '@/lib/messages';
import { canEditOrderOf, canManageFriday } from '@/lib/permissions';
import { assistantFacts, assistantResearch, getAssistantKey } from '@/lib/services/assistant';
import { requestLoginCode } from '@/lib/services/auth';
import {
  castVote,
  hostedFridaysBetween,
  loadFriday,
  openBalancesFor,
  paymentOpen,
  recordPayment,
  setAttendance,
  setDrinksOptOut,
  setLate,
  setRestaurant,
  takeOverFriday,
  type FridayView,
} from '@/lib/services/fridays';
import { addAbsence, ServiceError } from '@/lib/services/members';
import {
  addItem,
  getDefault,
  orderSame,
  orderUsual,
  removeItem,
  setDefaultDish,
  setItemQuantity,
} from '@/lib/services/orders';
import { getRestaurant, restaurantsForHost } from '@/lib/services/restaurants';
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

/** Why a member cannot change their own order or drinks right now, by the page's rules. */
function orderBlocked(view: FridayView, member: Member, now: Date): string | null {
  if (view.cancelled) return `Freitag (${formatDayShort(view.date)}) fällt aus.`;
  const state = { locked: view.locked || isPastDeadline(view.date, now), settled: view.settled };
  if (canEditOrderOf(member, { id: member.id, addedById: null }, view.host?.id ?? null, state)) {
    return null;
  }
  return state.settled
    ? 'Schon abgerechnet, da ändert sich nichts mehr.'
    : `Bestellschluss war um ${bold(formatTime(view.deadline))}. Sag ${view.host?.name ?? 'dem Gastgeber'} bitte direkt Bescheid.`;
}

/** A dish still on its menu. */
async function activeDish(db: Db, id: number) {
  const [dish] = await db
    .select()
    .from(dishes)
    .where(and(eq(dishes.id, id), eq(dishes.archived, false)));
  return dish ?? null;
}

/** `Margherita (Groß, Oliven)` */
function itemLabel(item: OrderItem): string {
  return `${item.name}${item.options.length ? ` (${item.options.map((option) => option.choiceName).join(', ')})` : ''}`;
}

type Send = (to: string, text: string) => Promise<unknown>;

/** A little less than the 20 seconds the bot waits for the app's answer. */
const BOT_PATIENCE_MS = 18_000;

/** How often each member may get Claude's reading per day. */
const assistantLimit = new DailyLimit();

/**
 * Answers a WhatsApp message from a member. Strangers get nothing at all, not even a
 * reading. A message no command matches goes to Claude (`lib/assistant.ts`), when a key is
 * set; without one, plain chat gets no reply. `interpreter` stands in for Claude in tests.
 */
export async function handleIncoming(
  db: Db,
  phone: string,
  text: string,
  now: Date,
  send: Send = sendWhatsApp,
  interpreter?: Interpreter | null
): Promise<string | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.phone, phone), eq(members.active, true), eq(members.kind, 'member')));
  if (!member) return null;
  const command = parseCommand(text);
  if (command.kind !== 'unknown') return runCommand(db, member, command, now, send);

  // The bot waits 20 seconds for the answer; the time counts from here.
  const started = Date.now();
  const interpret =
    interpreter !== undefined
      ? interpreter
      : await getAssistantKey(db).then((key) => (key ? claudeInterpreter(key) : null));
  if (!interpret) return null;
  if (!assistantLimit.take(String(member.id), now)) return LIMIT_TEXT;
  const { facts, restaurantIds } = await assistantFacts(db, member, text, now);
  let result: Interpretation | null;
  try {
    result = await interpret({
      facts,
      name: member.name,
      text,
      research: assistantResearch(db, member, now),
      until: started + ASSISTANT_BUDGET_MS,
    });
  } catch (error) {
    console.error('[assistant] reading failed', error);
    result = null;
  }
  if (!result) return ERROR_REPLY;
  const understood = understand(result, {
    restaurantIds,
    confirmed: /\bsicher\b/i.test(text),
    appOrigin: appUrl(),
  });
  // The bot has given up by now; acting anyway would surprise whoever sends it again.
  if (understood.command && Date.now() - started > BOT_PATIENCE_MS) return null;
  // Claude's lead-in first, then what the command itself says happened.
  const outcome = understood.command
    ? await runCommand(db, member, understood.command, now, send)
    : null;
  return [understood.reply, outcome].filter(Boolean).join('\n\n') || null;
}

/** Runs one command for a member and says what came of it. */
async function runCommand(
  db: Db,
  member: Member,
  command: Command,
  now: Date,
  send: Send
): Promise<string | null> {
  const phone = member.phone!;
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

    case 'order': {
      const view = await loadFriday(db, date, now);
      const blocked = orderBlocked(view, member, now);
      if (blocked) return blocked;
      if (view.mode === 'flat') {
        return `Diesmal gibt's ${bold(view.flatTitle ?? 'eine Pauschale')}, da gibt es nichts zu bestellen.`;
      }
      const dish = await activeDish(db, command.dishId);
      if (!dish) return 'Das Gericht gibt es nicht (mehr).';
      // Another restaurant than this Friday's only while the vote runs and it is on the ballot:
      // then it is ordered ahead and voted for, as from the ballot on the page.
      const ahead = dish.restaurantId !== view.restaurant?.id;
      const ballot = await restaurantsForHost(db, view.host?.id ?? null);
      if (
        ahead &&
        !(
          votingAt(view, now) &&
          ballot.length > 1 &&
          ballot.some((option) => option.id === dish.restaurantId)
        )
      ) {
        return view.restaurant
          ? `Diese Woche wird bei ${bold(view.restaurant.name)} bestellt, das Gericht ist von woanders.`
          : 'Das Restaurant steht noch nicht fest, bestellen geht erst danach.';
      }
      const mine = [...view.participants.flatMap((entry) => entry.items), ...view.preorders].filter(
        (item) => item.memberId === member.id && item.restaurantId === dish.restaurantId
      );
      try {
        await addItem(
          db,
          date,
          member.id,
          {
            dishId: dish.id,
            selection: completeSelection(dish.optionGroups, command.options),
            note: null,
            quantity: 1,
          },
          { from: ahead ? dish.restaurantId : undefined, vote: ahead, now }
        );
      } catch (error) {
        if (error instanceof ServiceError) return `${error.message}.`;
        throw error;
      }
      if (command.replace) {
        // A dish ordered before goes; the same dish again stays as one.
        for (const old of mine) {
          if (old.dishId === dish.id) await setItemQuantity(db, old.id, 1);
          else await removeItem(db, old.id);
        }
      }
      const after = await loadFriday(db, date, now);
      const item = [...after.participants.flatMap((entry) => entry.items), ...after.preorders]
        .filter((entry) => entry.memberId === member.id && entry.dishId === dish.id)
        .at(-1);
      const label = item ? itemLabel(item) : dish.name;
      const others = mine.filter((old) => old.dishId !== dish.id);
      const replaced =
        command.replace && others.length ? ` statt ${others.map(itemLabel).join(', ')}` : '';
      if (ahead) {
        const name = (await getRestaurant(db, dish.restaurantId))?.name ?? 'dem anderen Restaurant';
        return `🍽️ ${bold(label)}${replaced} ist bei ${name} vorbestellt und deine Stimme geht an ${name}. Es zählt, wenn ${name} die Wahl gewinnt.\nÄndern geht auf der Seite:\n${link}`;
      }
      return `🍽️ ${bold(label)}${replaced} ist bestellt, du bist dabei.\nÄndern oder mehr dazu geht auf der Seite:\n${link}`;
    }

    case 'removeOrder': {
      const view = await loadFriday(db, date, now);
      const blocked = orderBlocked(view, member, now);
      if (blocked) return blocked;
      const mine = [...view.participants.flatMap((entry) => entry.items), ...view.preorders].filter(
        (item) => item.memberId === member.id
      );
      const gone =
        command.itemId === null ? mine : mine.filter((item) => item.id === command.itemId);
      if (!gone.length) {
        return command.itemId === null
          ? 'Du hast gar nichts bestellt.'
          : 'Die Zeile gehört nicht zu deiner Bestellung.';
      }
      if (gone.length > 1 && !command.confirmed) {
        return `Das wären ${bold(gone.map(itemLabel).join(', '))}. Wenn wirklich alles raus soll, schreib: ${bold('alles raus sicher')}`;
      }
      for (const item of gone) await removeItem(db, item.id);
      const left = mine.length > gone.length;
      return [
        `🗑️ ${bold(gone.map(itemLabel).join(', '))} ${gone.length === 1 ? 'ist' : 'sind'} raus.`,
        ...(left
          ? []
          : [
              `Du bist weiter dabei. Such dir bis ${bold(formatTime(view.deadline))} was Neues aus, schreib ${bold('wie immer')}, oder ${bold('2')}, wenn du nichts isst.`,
            ]),
        link,
      ].join('\n');
    }

    case 'setDefault': {
      const dish = await activeDish(db, command.dishId);
      if (!dish) return 'Das Gericht gibt es nicht (mehr).';
      const selection = completeSelection(dish.optionGroups, command.options);
      try {
        await setDefaultDish(db, member.id, dish.restaurantId, {
          dishId: dish.id,
          selection,
          note: null,
        });
      } catch (error) {
        if (error instanceof ServiceError) return `${error.message}.`;
        throw error;
      }
      const choices = dish.optionGroups.flatMap((group) =>
        group.choices
          .filter((choice) => selection[group.id]?.includes(choice.id))
          .map((choice) => choice.name)
      );
      const restaurant = await getRestaurant(db, dish.restaurantId);
      return `⭐ ${bold(`${dish.name}${choices.length ? ` (${choices.join(', ')})` : ''}`)} ist jetzt dein Standard bei ${restaurant?.name ?? 'dem Restaurant'}. Sagst du nichts, bekommst du das dort.`;
    }

    case 'drinks': {
      const view = await loadFriday(db, date, now);
      const blocked = orderBlocked(view, member, now);
      if (blocked) return blocked;
      await setDrinksOptOut(db, date, member.id, !command.on);
      return command.on
        ? `🍻 Getränkepauschale ist wieder an (${formatEuro(view.drinksFeeCents)}).`
        : `🚰 Alles klar, diesmal ohne Getränkepauschale.`;
    }

    case 'absence': {
      const today = todayIso(now);
      if (command.to < command.from) return 'Das Ende liegt vor dem Anfang.';
      if (command.to < today) return 'Das liegt schon in der Vergangenheit.';
      const from = command.from < today ? today : command.from;
      if (daysBetween(from, command.to) > 366) {
        return `So lange? Trag das bitte selbst ein:\n${appUrl()}/kalender#abwesend`;
      }
      await addAbsence(db, member.id, from, command.to, null);
      const hosting = await hostedFridaysBetween(db, member.id, from, command.to, now);
      return [
        `✈️ Eingetragen: weg ${from === command.to ? `am ${formatDayShort(from)}` : `vom ${formatDayShort(from)} bis ${formatDayShort(command.to)}`}. An den Freitagen dazwischen bist du raus und bekommst nichts.`,
        ...(hosting.length
          ? [
              `Am ${formatDayList(hosting)} bist du Gastgeber: Klär, wer übernimmt, oder trag es im Kalender ein.`,
            ]
          : []),
        `${appUrl()}/kalender`,
      ].join('\n');
    }

    case 'pickRestaurant': {
      // The same rule as on the page: only the host and admins settle the restaurant.
      const view = await loadFriday(db, date, now);
      if (!canManageFriday(member, view.host?.id ?? null)) {
        return 'Das Restaurant legen nur der Gastgeber und Admins fest. Du kannst mit dem Buchstaben abstimmen.';
      }
      const option = (await restaurantsForHost(db, view.host?.id ?? null)).find(
        (entry) => entry.id === command.restaurantId
      );
      if (!option) return 'Das Restaurant steht für diesen Freitag nicht zur Auswahl.';
      if (
        view.cancelled ||
        view.settled ||
        view.mode === 'flat' ||
        view.locked ||
        isPastDeadline(date, now)
      ) {
        return 'Das Restaurant lässt sich hier nur an einem offenen Lieferfreitag festlegen, sonst bitte auf der Seite.';
      }
      if (view.restaurant?.id === option.id && view.restaurantChosen) {
        return `${bold(option.name)} steht schon fest. 🍽️`;
      }
      const ends = votingAt(view, now);
      const dropped = [
        ...view.participants.flatMap((entry) => entry.items),
        ...view.preorders,
      ].filter((item) => item.restaurantId !== option.id).length;
      if ((ends || dropped > 0) && !command.confirmed) {
        return [
          `${bold(option.name)} festlegen${ends ? ' beendet die Restaurantwahl' : ''}${ends && dropped ? ' und' : ''}${dropped ? ` wirft ${dropped} ${dropped === 1 ? 'Bestellung' : 'Bestellungen'} bei anderen Restaurants raus` : ''}.`,
          `Wenn du dir sicher bist, schreib: ${bold(`${option.name} festlegen sicher`)}`,
        ].join('\n');
      }
      try {
        await setRestaurant(db, date, option.id);
      } catch (error) {
        if (error instanceof ServiceError) return `${error.message}.`;
        throw error;
      }
      return [
        `🍽️ Steht fest: Freitag gibt's ${bold(option.name)}${option.delivers ? '' : ' (nur abholen)'}.`,
        ...(ends ? ['Die Restaurantwahl ist damit vorbei.'] : []),
        ...(dropped ? ['Bestellungen bei anderen Restaurants sind damit raus.'] : []),
        link,
      ].join('\n');
    }

    case 'help':
      return HELP_TEXT;

    case 'unknown':
      return null;
  }
}
