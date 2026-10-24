import { isBilled, payeeOf, payeePurpose, payeesFor, shareLines, type Money } from '@/lib/balance';
import { autoReleaseAt, berlinAt, daysBetween, todayIso, type IsoDate } from '@/lib/dates';
import { formatDayShort, formatEuro, formatTime } from '@/lib/format';
import { bold } from '@/lib/messages';
import { orderSheetText, sheetsByArrival } from '@/lib/order-sheet';
import { paypalMeLink } from '@/lib/paypal';
import type { FridayView, Participant } from '@/lib/services/fridays';
import {
  couldSwing,
  standings,
  voteClosesAt,
  voteEndsText,
  voteLetter,
  votingAt,
  type VoteOption,
} from '@/lib/vote';

export type Outgoing = { key: string; to: string; text: string };

/** How often the scheduler runs (`instrumentation.ts`). */
export const SCHEDULER_INTERVAL_MS = 60_000;
const PAY_REMINDER_DAYS = 10;
const SETTLE_REMINDER_DAYS = 1;
/** Differences below this are not worth a message; they show on the page all the same. */
export const NAG_THRESHOLD_CENTS = 50;
/** Nobody hears from the bot before ten; whatever falls due at night waits until then. */
const QUIET_UNTIL_HOUR = 10;

/** Whoever would go hungry hears once more this long before the deadline. */
const LAST_CALL_MINUTES_BEFORE = 30;

function lastCallAt(view: FridayView): Date {
  return new Date(view.deadline.getTime() - LAST_CALL_MINUTES_BEFORE * 60_000);
}

/** `at`, or ten that morning when `at` falls into the night's quiet. */
function awake(at: Date): Date {
  const morning = berlinAt(todayIso(at), 0, QUIET_UNTIL_HOUR);
  return at < morning ? morning : at;
}

type Input = {
  view: FridayView;
  now: Date;
  appUrl: string;
  /** Default dish name per member for this Friday's restaurant. */
  defaultDish: Map<number, string>;
  /** Group chat to announce in, if one is configured. */
  group: string | null;
  /** Keys already sent for this Friday, for messages that follow up on earlier ones. */
  sent: Set<string>;
  /** The link that ticks off one person's balance for this Friday without a login. */
  paidLink: (memberId: number) => string;
  /** The restaurants this Friday's host can order from, in the vote's order. */
  restaurants: VoteOption[];
  /**
   * What each member had the last time at this Friday's restaurant, for the last call to
   * offer „gleiches“; e.g. `HDD Döner Teller, 2× Pommes`.
   */
  lastOrder?: Map<number, { date: IsoDate; items: string }>;
};

function between(now: Date, from: Date, to: Date) {
  return now >= from && now < to;
}

/** How to pay what is open, per payee when the food and the drinks go to two people. */
function payLines(view: FridayView, money: Money) {
  const payees = payeesFor(view, money);
  const split = payees.length > 1;
  const lines = payees.map((payee) => {
    const intro = split
      ? `${bold(formatEuro(payee.cents))} ${payeePurpose(payee.what)} an ${payee.name}:\n`
      : '';
    return payee.paypalMe
      ? `${intro}PayPal: ${paypalMeLink(payee.paypalMe, payee.cents)}`
      : `${intro}Bitte direkt ${split ? '' : `an ${payee.name} `}zahlen.`;
  });
  if (payees.some((payee) => payee.paypalMe)) {
    // The PayPal app opens these links but does not always take the amount over.
    lines.push(
      split
        ? 'Fehlt in der PayPal-App der Betrag, trag ihn einfach selbst ein.'
        : `Fehlt in der PayPal-App der Betrag, trag einfach ${bold(formatEuro(payees[0]!.cents))} ein.`,
      'Bitte als „Freunde und Familie“.'
    );
  }
  return lines.join('\n');
}

/** `Übermorgen`, `Morgen`, `Heute`, `In 4 Tagen`: how far off the Friday is. */
function untilFriday(date: string, now: Date) {
  const days = daysBetween(todayIso(now), date);
  return days <= 0
    ? 'Heute'
    : days === 1
      ? 'Morgen'
      : days === 2
        ? 'Übermorgen'
        : `In ${days} Tagen`;
}

/**
 * The ballot, short enough for a phone: every restaurant with its letter, the current one
 * crowned, and how it ends. Menus, delivery terms and ordering ahead are behind the link.
 */
function ballot(
  options: VoteOption[],
  current: { id: number; name: string } | null,
  date: IsoDate,
  now: Date
) {
  const day = daysBetween(todayIso(now), date) <= 0 ? 'heute' : 'am Freitag';
  return [
    `🗳️ ${bold(`Wo bestellen wir ${day}?`)} Antworte mit dem Buchstaben:`,
    ...options.map(
      (option, index) =>
        `${bold(voteLetter(index))} · ${option.name}${option.id === current?.id ? ' 👑' : ''}${
          option.delivers ? '' : ' (nur abholen)'
        }`
    ),
    `${
      current
        ? `Wählt keiner, bleibt's beim 👑 ${current.name}`
        : 'Wählt keiner, sucht der Gastgeber aus'
    }. Abstimmen bis ${bold(voteEndsText(date, now))}, wer abstimmt, ist dabei.`,
  ].join('\n');
}

const ANSWER_OPTIONS = [
  `${bold('1')} – bin dabei`,
  `${bold('2')} – komme, esse aber nix`,
  `${bold('3')} – bin raus`,
];
const ANSWER_HINT = ['Bist du dabei? Antworte mit', ...ANSWER_OPTIONS].join('\n');

/**
 * Every WhatsApp message one Friday calls for at `now`. Each message has a key; the
 * scheduler sends a key once, so this can run every minute. Every window ends, so a
 * container that was down does not send yesterday's reminders.
 */
export function planReminders({
  view,
  now,
  appUrl,
  defaultDish,
  group,
  sent,
  paidLink,
  restaurants,
  lastOrder = new Map(),
}: Input): Outgoing[] {
  const out: Outgoing[] = [];
  if (awake(now) > now) return out;
  const date = view.date;
  const day = formatDayShort(date);
  const link = `${appUrl}/freitag/${date}`;
  const host = view.host?.name ?? 'uns';
  const place = view.hostAbsent ? ' (wo, klären wir noch)' : `, bei ${host}`;
  const hostPhone = view.host?.phone ?? null;
  const flat = view.mode === 'flat';
  const reachable = view.participants.filter(
    (entry) => entry.member.kind === 'member' && entry.member.active && entry.member.phone
  );
  const phoneOf = (id: number | null) =>
    view.participants.find((entry) => entry.member.id === id)?.member.phone ?? null;
  // Guests have no phone here; whoever brought them hears about their money.
  const billTo = (entry: Participant) =>
    entry.member.kind === 'guest'
      ? { phone: phoneOf(entry.addedById), prefix: `Für deinen Gast ${entry.member.name}: ` }
      : { phone: entry.member.phone, prefix: '' };

  if (view.cancelled) {
    if (between(now, berlinAt(date, -2, 12), view.deadline)) {
      const text = [
        `😢 ${bold(`Freitag (${day}) fällt aus.`)}`,
        view.cancelReason,
        `Was als Nächstes ansteht: ${appUrl}/kalender`,
      ]
        .filter(Boolean)
        .join('\n');
      for (const entry of reachable) {
        out.push({ key: `cancel:${date}:${entry.member.id}`, to: entry.member.phone!, text });
      }
      if (group) out.push({ key: `cancel:${date}:group`, to: group, text });
    }
    return out;
  }

  // An absent host would order from the beach, so they hear about it until someone takes over.
  if (view.hostAbsent && hostPhone) {
    for (const [key, at] of [
      ['mon', berlinAt(date, -4, 18)],
      ['wed', berlinAt(date, -2, 10)],
    ] as const) {
      if (between(now, at, view.deadline)) {
        out.push({
          key: `hostaway:${date}:${key}`,
          to: hostPhone,
          text: `🏖️ ${bold(`Freitag (${day}) bist du weg`)}, stehst aber als Gastgeber drin. Die Bande braucht ein Dach!\nTrag ein, wer übernimmt, oder sag den Freitag ab:\n${appUrl}/kalender`,
        });
      }
    }
  }

  const voting = votingAt(view, now) && restaurants.length > 1;
  const noRestaurant = !flat && !view.restaurant;
  const fridayMorning = berlinAt(date, 0, 10);
  if (noRestaurant && hostPhone) {
    for (const [key, at] of [
      ['thu', berlinAt(date, -1, 18)],
      // With the invitations, which then say the restaurant is still to come, or once the
      // group has voted without deciding.
      ['fri', restaurants.length > 1 ? voteClosesAt(date) : fridayMorning],
    ] as const) {
      // While the group still votes, a pick from the host would end the vote.
      if (voting) continue;
      if (between(now, at, view.deadline)) {
        out.push({
          key: `pick:${date}:${key}`,
          to: hostPhone,
          text: `🤔 ${bold(`Für Freitag (${day}) steht noch kein Restaurant fest.`)}\nDie Mägen werden unruhig. Such eins aus, dann können alle bestellen:\n${link}`,
        });
      }
    }
  }

  const deadline = formatTime(view.deadline);
  const invited = (id: number) =>
    sent.has(`invite:${date}:${id}`) || sent.has(`invite-open:${date}:${id}`);
  /** What happens to someone who is in but orders nothing: their default, or no food. */
  const orderFallback = (memberId: number) => {
    const fallback = defaultDish.get(memberId);
    return fallback ? `bekommst du deinen Standard (${bold(fallback)})` : 'gibt’s für dich nichts';
  };

  const what = flat
    ? `gibt's ${view.flatTitle ?? 'was Leckeres'} für ${formatEuro(view.flatPriceCents ?? 0)} pro Person`
    : voting
      ? `bestellen wir zusammen (Restaurant wird bis ${formatTime(voteClosesAt(date))} gewählt)`
      : view.restaurant
        ? `bestellen wir bei ${view.restaurant.name}${view.picker ? ` (${view.picker.name} holt ab)` : ''}`
        : 'bestellen wir zusammen (Restaurant kommt noch)';
  const rule = flat ? 'Dafür brauchen wir deine Zusage.' : 'Wer nichts sagt, ist dabei.';
  const unanswered = reachable.filter(
    (entry) => entry.attendance.reason === 'silent' && entry.member.id !== view.host?.id
  );

  // On Wednesday, once it is clear the Friday happens, a first question who comes, and,
  // unless the host picked the restaurant, the vote on where to order. The question ends
  // where the invitations begin, the ballot with the vote.
  const hasVoted = (id: number) => view.votes.some((vote) => vote.memberId === id);
  const vote = ballot(restaurants, view.restaurant, date, now);
  const more = `Karten, Lieferkosten und Vorbestellen:\n${link}`;
  /** The end of a message that asks who comes: the ballot, or that their vote is in. */
  const voteLines = (id: number) =>
    !voting
      ? [link]
      : hasVoted(id)
        ? [
            `Die Restaurantwahl läuft bis ${bold(voteEndsText(date, now))}. Deine Stimme ist schon drin.`,
            link,
          ]
        : [vote, '', more];
  if (between(now, berlinAt(date, -2, 12), fridayMorning)) {
    const hello = `${untilFriday(date, now)} ist wieder Freitag${place}`;
    // The question who comes first, the vote after it; one link for everything else.
    for (const entry of unanswered) {
      out.push({
        key: `ask:${date}:${entry.member.id}`,
        to: entry.member.phone!,
        text: [
          `🍕 ${bold(`${hello}!`)}${voting ? '' : ` Diesmal ${what}.`}`,
          ANSWER_HINT,
          rule,
          '',
          ...voteLines(entry.member.id),
        ].join('\n'),
      });
    }
  }
  if (voting && now >= berlinAt(date, -2, 12)) {
    for (const entry of reachable) {
      const id = entry.member.id;
      if (entry.attendance.status === 'out' || hasVoted(id)) continue;
      if (unanswered.some((other) => other.member.id === id)) continue;
      // „Kommst du?“ and the invitation carry the ballot; answering them must not send it again.
      if (sent.has(`ask:${date}:${id}`) || invited(id)) continue;
      out.push({
        key: `vote:${date}:${id}`,
        to: entry.member.phone!,
        text: `${vote}\n\n${more}`,
      });
    }
  }

  // Thursday evening, a nudge for whoever got the ballot, is coming and has not voted, as
  // long as their votes could still change what the vote decides.
  if (voting && between(now, berlinAt(date, -1, 18), berlinAt(date, 0, 0))) {
    const missing = reachable.filter(
      (entry) =>
        entry.attendance.status !== 'out' &&
        !hasVoted(entry.member.id) &&
        (sent.has(`ask:${date}:${entry.member.id}`) || sent.has(`vote:${date}:${entry.member.id}`))
    );
    const optionIds = restaurants.map((option) => option.id);
    if (couldSwing(view.votes, optionIds, view.restaurant?.id ?? null, missing.length)) {
      const nameOf = (id: number) =>
        view.participants.find((entry) => entry.member.id === id)?.member.name ?? '?';
      const stand = standings(restaurants, view.votes, nameOf);
      const text = [
        `🗳️ ${bold('Deine Stimme kann’s noch drehen!')}`,
        `Das Wahllokal schließt ${bold(voteEndsText(date, now))}, und von dir fehlt noch die Stimme.`,
        '',
        bold('Stand:'),
        ...(stand.length
          ? stand
          : [
              view.restaurant
                ? `Noch keine Stimme, dann bleibt's beim 👑 ${view.restaurant.name}.`
                : 'Noch keine Stimme, dann sucht der Gastgeber aus.',
            ]),
        '',
        ...restaurants.map(
          (option, index) =>
            `${bold(voteLetter(index))} · ${option.name}${option.id === view.restaurant?.id ? ' 👑' : ''}`
        ),
        '',
        'Antworte mit dem Buchstaben. Auf der Seite kannst du beim Restaurant deiner Wahl schon vorbestellen, das zählt, wenn es gewinnt.',
        link,
      ].join('\n');
      for (const entry of missing) {
        out.push({ key: `votenudge:${date}:${entry.member.id}`, to: entry.member.phone!, text });
      }
    }
  }

  // The vote left these without an order from the restaurant it chose: their orders went,
  // their pick lost, or they said yes to the one it replaced. They hear about it as soon as
  // it closes; whoever has not answered yet is asked here, too.
  if (!flat && view.restaurant && !view.locked && between(now, voteClosesAt(date), view.deadline)) {
    const restaurant = view.restaurant;
    for (const id of view.voteDroppedIds) {
      const entry = view.participants.find((participant) => participant.member.id === id);
      if (!entry || entry.items.length > 0 || entry.attendance.status !== 'in') continue;
      const { phone, prefix } = billTo(entry);
      if (!phone) continue;
      const pick = `Such dir bis ${bold(deadline)} dort was aus, sonst ${orderFallback(id)}.`;
      const asks = unanswered.some((other) => other.member.id === id);
      out.push({
        key: `revote:${date}:${id}`,
        to: phone,
        text: asks
          ? `🗳️ ${prefix}${bold('Das Volk hat gewählt:')} Heute gibt's ${bold(restaurant.name)}${place}!\n\n${ANSWER_HINT}\n\n${rule}\n${pick}\n${link}`
          : `🗳️ ${prefix}${bold('Das Volk hat gewählt:')} Heute gibt's ${bold(restaurant.name)}!\n${pick}\n${link}`,
      });
    }
  }
  // The result can go out in the same pass as the invitation, the restaurant's announcement
  // or the order reminder, so it stands in for them whether it went out before or goes out now.
  const toldResult = (id: number) =>
    sent.has(`revote:${date}:${id}`) ||
    out.some((message) => message.key === `revote:${date}:${id}`);

  // The invitation goes out on the Friday morning. Without a restaurant by then, or while
  // the group still votes, it goes out anyway, and a second message follows once it is
  // decided; during the vote it carries the ballot.
  if (between(now, fridayMorning, berlinAt(date, 0, 17))) {
    const open = noRestaurant || voting;
    // Silent members count as in, so the invitation also carries the order reminder.
    const orderHint = (memberId: number) =>
      !flat && !open
        ? `\nSuch dir bis ${bold(deadline)} was aus, sonst ${orderFallback(memberId)}.`
        : '';
    for (const entry of unanswered) {
      const id = entry.member.id;
      // The vote's result already asked them, with the restaurant it chose.
      if (invited(id) || toldResult(id)) continue;
      out.push({
        key: `${open ? 'invite-open' : 'invite'}:${date}:${id}`,
        to: entry.member.phone!,
        text: [
          `🎉 ${bold(`Es ist Freitag, ${entry.member.name}!`)}`,
          `${bold(`Heute ${what}`)}${place}.`,
          '',
          ANSWER_HINT,
          '',
          `${rule}${orderHint(id)}`,
          ...(voting ? ['', ...voteLines(id)] : [link]),
        ].join('\n'),
      });
    }
    if (group && !sent.has(`invite:${date}:group`)) {
      out.push({
        key: `invite:${date}:group`,
        to: group,
        text: `🎉 ${bold(`Es ist Freitag! Heute ${what}`)}${place}.\n${flat ? 'Anmeldeschluss' : 'Bestellschluss'}: ${bold(deadline)}\n${link}`,
      });
    }
  }

  const eatsWithoutOrder = (entry: Participant) =>
    entry.attendance.status === 'in' &&
    entry.items.length === 0 &&
    entry.member.id !== view.host?.id;

  if (!flat && view.restaurant && !view.locked && now < view.deadline) {
    const restaurant = view.restaurant;
    // Whoever was invited before the restaurant was decided hears it once it is.
    for (const entry of voting ? [] : reachable.filter(eatsWithoutOrder)) {
      const id = entry.member.id;
      if (!sent.has(`invite-open:${date}:${id}`) || toldResult(id)) continue;
      out.push({
        key: `restaurant:${date}:${restaurant.id}:${id}`,
        to: entry.member.phone!,
        text: `📣 Für heute steht es fest: ${bold(restaurant.name)}.\nSuch dir bis ${bold(deadline)} was aus, sonst ${orderFallback(id)}.\n${link}`,
      });
    }

    const remind = (key: string, text: (entry: Participant) => string, entries: Participant[]) => {
      for (const entry of entries) {
        out.push({
          key: `${key}:${date}:${entry.member.id}`,
          to: entry.member.phone!,
          text: `${text(entry)}\n${link}`,
        });
      }
    };
    const withoutOrder = reachable.filter(eatsWithoutOrder);
    // Who says yes after a reminder's time was just told to pick something (by the bot's
    // reply, or on the page), so the reminder is only for those who answered before it.
    const answeredBefore = (entry: Participant, at: Date) =>
      entry.attendance.reason !== 'answered' ||
      (entry.answeredAt !== null && entry.answeredAt < at);
    // Friday morning, or once the vote has decided where, for whoever said yes without the
    // invitation, which already asked them to pick something, or the vote's result, which
    // did too.
    if (!voting && between(now, fridayMorning, view.deadline)) {
      remind(
        'order',
        (entry) => {
          const usual = defaultDish.get(entry.member.id);
          // With a default, nothing goes wrong by staying silent: it only offers a change.
          return usual
            ? `🍽️ Heute gibt's ${bold(restaurant.name)}. Sagst du nichts, bekommst du deinen Standard (${bold(usual)}). Lieber was anderes? Aussuchen geht bis ${bold(deadline)}:`
            : `🍽️ ${bold('Dein Magen hat angerufen:')} Du hast für heute Abend noch nichts ausgesucht.\nBis ${bold(deadline)} kannst du bei ${bold(restaurant.name)} aussuchen, sonst gibt’s für dich nichts.`;
        },
        withoutOrder.filter(
          (entry) =>
            entry.attendance.reason === 'answered' &&
            answeredBefore(entry, fridayMorning) &&
            !invited(entry.member.id) &&
            !toldResult(entry.member.id)
        )
      );
    }
    // Whoever has no default would go hungry, so they hear once more, with what they had
    // last time here to order again by replying „gleiches“.
    const lastCall = lastCallAt(view);
    if (between(now, lastCall, view.deadline)) {
      remind(
        'lastcall',
        (entry) => {
          const last = lastOrder.get(entry.member.id);
          return [
            `⏰ ${bold('Letzte Chance!')} Bis ${bold(deadline)} kannst du noch bei ${bold(restaurant.name)} aussuchen, sonst schaust du heute Abend nur beim Essen zu.`,
            ...(last
              ? [
                  `Am ${formatDayShort(last.date)} hattest du hier ${bold(last.items)}. Antworte ${bold('gleiches')}, dann bestell ich dir das wieder.`,
                ]
              : []),
          ].join('\n');
        },
        withoutOrder.filter(
          (entry) => !defaultDish.has(entry.member.id) && answeredBefore(entry, lastCall)
        )
      );
    }
  }

  const sheetUntil = new Date(view.deadline.getTime() + 3 * 3_600_000);
  // Paying opens when the host releases it (or the next morning on its own), and the bot
  // tells about it unless the host released it silently.
  const tellsPay = view.paymentReleasedAt !== null && view.paymentNotify;
  const today = todayIso(now);
  const dayOffset = daysBetween(date, today);
  const settledSays = view.settled && !flat;
  const refundFrom = (money: Money) =>
    payeeOf(view, money.debts.find((debt) => debt.openCents < 0) ?? { payeeId: null })?.name ??
    host;
  // What someone owes as settled, or gets back.
  const settledText = (entry: Participant, open: number, prefix: string) =>
    open > 0
      ? `🧮 ${prefix}${bold('Abgerechnet:')} noch ${bold(formatEuro(open))} offen.\n\n${payLines(view, entry.money)}\n\nSchon gezahlt? Hier abhaken:\n${paidLink(entry.member.id)}`
      : `🧮 ${prefix}${bold('Abgerechnet:')} ${bold(formatEuro(-open))} zu viel gezahlt, ${refundFrom(entry.money)} gibt das zurück.`;
  if (view.locked && tellsPay && dayOffset <= PAY_REMINDER_DAYS) {
    for (const entry of view.participants) {
      const open = entry.money.openCents;
      if ((settledSays ? Math.abs(open) : open) < NAG_THRESHOLD_CENTS) continue;
      const { phone, prefix } = billTo(entry);
      if (!phone) continue;
      // Settled by the time the link goes out, it tells the settled amount.
      if (settledSays) {
        out.push({
          key: `due:${date}:${entry.member.id}`,
          to: phone,
          text: settledText(entry, open, prefix),
        });
        continue;
      }
      const guest = entry.member.kind === 'guest' ? entry.member.name : null;
      const amount = bold(formatEuro(open));
      // What the money is for, said with a wink: a seat, a meal, or only the drinks.
      const opener = flat
        ? `🎟️ ${bold('Anmeldeschluss!')} ${guest ? `Dein Gast ${guest} ist dabei` : 'Dein Platz ist sicher'}, jetzt darf ${guest ? 'dein' : 'der'} Geldbeutel nachziehen: ${amount}.`
        : entry.items.length === 0
          ? `🥤 ${bold('Bestellschluss!')} Ohne Essen, aber nicht ohne Durst: ${amount} für die Getränke${guest ? ` von ${guest}` : ''}.`
          : `🍽️ ${bold('Bestellschluss!')} ${guest ? `Dein Gast ${guest} hat` : 'Dein Magen hat'} bestellt, jetzt darf ${guest ? 'dein' : 'der'} Geldbeutel nachziehen: ${amount}.`;
      out.push({
        key: `due:${date}:${entry.member.id}`,
        to: phone,
        text: [
          opener,
          '',
          ...shareLines(view, entry).map((line) => `${line.label}: ${formatEuro(line.cents)}`),
          '',
          payLines(view, entry.money),
          ...(flat || view.pickup
            ? []
            : ['Kostet’s am Ende ein paar Cent anders, gleichen wir das nach der Abrechnung aus.']),
          '',
          `Schon gezahlt? Hier abhaken:\n${paidLink(entry.member.id)}`,
        ].join('\n'),
      });
    }
  }

  // After the host settled or sent the links again, only whoever's amount changed hears the
  // new one; the others' links still tell the right amount.
  if (view.locked && tellsPay && view.paymentRound > 0 && dayOffset <= PAY_REMINDER_DAYS) {
    for (const entry of view.participants) {
      if (!view.paymentChangedIds.includes(entry.member.id)) continue;
      const open = entry.money.openCents;
      if (Math.abs(open) < NAG_THRESHOLD_CENTS) continue;
      const { phone, prefix } = billTo(entry);
      if (!phone) continue;
      out.push({
        key: `fix:${date}:${entry.member.id}:r${view.paymentRound}`,
        to: phone,
        text: `🔁 ${bold('Korrektur, der Betrag hat sich geändert.')}\n${
          settledSays
            ? settledText(entry, open, prefix)
            : open > 0
              ? `${prefix}Jetzt noch ${bold(formatEuro(open))} offen.\n\n${payLines(view, entry.money)}\n\nSchon gezahlt? Hier abhaken:\n${paidLink(entry.member.id)}`
              : `${prefix}${bold(formatEuro(-open))} zu viel gezahlt, ${refundFrom(entry.money)} gibt das zurück.`
        }`,
      });
    }
  }

  // The order list goes to whoever orders: the host, or whoever fetches the food.
  const ordererPhone = view.picker ? view.picker.phone : hostPhone;
  if (view.locked && ordererPhone && between(now, view.deadline, sheetUntil)) {
    const eating = view.participants.filter((entry) => entry.attendance.status === 'in').length;
    // Whoever comes later gets a block of their own: their food can be ordered later.
    const sheets = sheetsByArrival(
      view.participants,
      (id) => view.participants.find((entry) => entry.member.id === id)?.member.name ?? '?'
    );
    const sheet = orderSheetText(sheets.now);
    const later = orderSheetText(sheets.later);
    const restaurant = bold(view.restaurant?.name ?? 'das Restaurant');
    const lieferando = view.restaurant?.lieferandoUrl;
    out.push({
      key: `sheet:${date}`,
      to: ordererPhone,
      text: flat
        ? `📋 ${bold('Anmeldeschluss:')} ${eating} Leute sind dabei.\n${link}`
        : [
            `${view.pickup ? '🛍️' : '🛵'} ${bold('Bestellschluss!')} ${view.pickup ? `Zum Abholen bei ${restaurant}` : `Das geht an ${restaurant}`}:`,
            '',
            sheet || (later ? 'Jetzt nichts, alle kommen später.' : 'Niemand hat etwas bestellt.'),
            ...(later ? ['', `🕘 ${bold('Kommen später, lieber später bestellen:')}`, later] : []),
            ...(view.voucherCents
              ? ['', `${bold('Gutschein einlösen:')} ${formatEuro(view.voucherCents)}`]
              : []),
            '',
            view.pickup
              ? `Das Essensgeld der anderen kommt zu dir. Kostet es im Restaurant anders, kann ${host} den Betrag eintragen:\n${link}`
              : `${lieferando ? `Bestellen: ${lieferando}\n\n` : ''}Nach der Bestellung den Betrag hier eintragen:\n${link}`,
          ].join('\n'),
    });
  }

  const morning = [berlinAt(date, dayOffset, 10), berlinAt(date, dayOffset + 1, 0)] as const;
  const evening = [berlinAt(date, dayOffset, 18), berlinAt(date, dayOffset + 1, 0)] as const;
  const hasOrders = view.participants.some((entry) => entry.items.length > 0);

  // Fetched food costs the menu prices, so there is no real total to ask for.
  if (!flat && !view.pickup && view.locked && !view.settled && hasOrders && hostPhone) {
    if (dayOffset >= 1 && dayOffset <= SETTLE_REMINDER_DAYS && between(now, ...morning)) {
      out.push({
        key: `settle:${date}:${today}`,
        to: hostPhone,
        text: `🧾 ${bold(`Was hat Freitag (${day}) bei Lieferando gekostet?`)}\nWeicht es von der Schätzung ab, trag den Betrag ein, dann bekommt eine Korrektur, wessen Betrag sich ändert. Sonst bleibt es bei der Schätzung:\n${link}`,
      });
    }
  }

  if (isBilled(view)) {
    for (const entry of view.participants) {
      const open = entry.money.openCents;
      if (Math.abs(open) < NAG_THRESHOLD_CENTS) continue;
      const { phone, prefix } = billTo(entry);
      if (!phone) continue;
      // The reminders start the day after the link went out.
      if (
        open > 0 &&
        tellsPay &&
        today > todayIso(view.paymentReleasedAt!) &&
        dayOffset >= 1 &&
        dayOffset <= PAY_REMINDER_DAYS &&
        between(now, ...evening)
      ) {
        out.push({
          key: `pay:${date}:${entry.member.id}:${today}`,
          to: phone,
          text: `💸 ${prefix}${bold('Kleine Erinnerung:')} Für Freitag (${day}) sind noch ${bold(formatEuro(open))} offen.\n\n${payLines(view, entry.money)}\n\nSchon gezahlt? Hier abhaken, dann hören die Erinnerungen auf:\n${paidLink(entry.member.id)}`,
        });
      }
    }
  }

  return out;
}

/**
 * The moments ahead at which `planReminders` sends something new for this Friday: the
 * scheduler's next pass (for whatever is due right away, or at ten after a quiet night),
 * each window that opens up to the deadline, and the next morning and evening after it.
 * Settle and pay reminders repeat daily, so the overview shows the next one of each.
 */
function previewTimes(view: FridayView, now: Date): Date[] {
  const date = view.date;
  const afterDeadline = Array.from({ length: PAY_REMINDER_DAYS }, (_, day) => [
    berlinAt(date, day + 1, 10),
    berlinAt(date, day + 1, 18),
  ])
    .flat()
    .filter((at) => at > now)
    .slice(0, 2);
  return [
    awake(new Date(now.getTime() + SCHEDULER_INTERVAL_MS)),
    berlinAt(date, -4, 18),
    berlinAt(date, -2, 10),
    berlinAt(date, -2, 12),
    berlinAt(date, -1, 18),
    berlinAt(date, 0, 10),
    voteClosesAt(date),
    lastCallAt(view),
    view.deadline,
    autoReleaseAt(date),
    ...afterDeadline,
  ]
    .filter((at) => at > now)
    .sort((a, b) => a.getTime() - b.getTime());
}

export type PlannedMessage = Outgoing & { at: Date };

/**
 * What this Friday will still send, to whom and when, as things stand now: `planReminders`
 * run at each moment ahead, from the deadline on with the Friday locked as it will be then.
 * Answers and orders until then change it.
 */
export function previewReminders(
  input: Omit<Input, 'now'>,
  now: Date,
  /** The Friday as the running vote would leave it, for the times after it closes. */
  afterVote?: Pick<Input, 'view' | 'defaultDish'>
): PlannedMessage[] {
  const planned = new Map<string, PlannedMessage>();
  // What goes out at one moment counts as sent at the next, as it will for the scheduler.
  const sent = new Set(input.sent);
  const closes = voteClosesAt(input.view.date);
  for (const at of previewTimes(input.view, now)) {
    const state = afterVote && at >= closes ? afterVote : input;
    const closed = at >= state.view.deadline && !state.view.cancelled;
    // Unless the host releases paying first, it is released the next morning.
    const released =
      closed && !state.view.paymentReleasedAt && at >= autoReleaseAt(state.view.date);
    const view = released
      ? { ...state.view, locked: true, paymentReleasedAt: at, paymentNotify: true }
      : closed
        ? { ...state.view, locked: true }
        : state.view;
    for (const message of planReminders({
      ...input,
      defaultDish: state.defaultDish,
      sent,
      view,
      now: at,
    })) {
      if (!sent.has(message.key) && !planned.has(message.key)) {
        planned.set(message.key, { ...message, at });
      }
    }
    for (const key of planned.keys()) sent.add(key);
  }
  return [...planned.values()];
}

const MESSAGE_KINDS: Record<string, string> = {
  cancel: 'Absage',
  hostaway: 'Gastgeber ist weg, wer übernimmt?',
  pick: 'Restaurant aussuchen',
  ask: 'Kommst du?',
  vote: 'Restaurantwahl',
  votenudge: 'Erinnerung Restaurantwahl',
  revote: 'Ergebnis der Wahl',
  invite: 'Einladung',
  'invite-open': 'Einladung',
  restaurant: 'Restaurant steht fest',
  order: 'Noch nichts ausgesucht',
  lastcall: 'Letzte Chance',
  due: 'Betrag und Zahl-Link',
  sheet: 'Bestellliste',
  settle: 'Was hat es gekostet?',
  settled: 'Abrechnung',
  fix: 'Korrektur',
  pay: 'Zahl-Erinnerung',
};

export type MessagePreview = { at: Date; kind: string; recipients: string[] };

/** Planned messages as one line per time and kind, with the recipients by name. */
export function summarizePlanned(
  planned: PlannedMessage[],
  view: FridayView,
  group: string | null
): MessagePreview[] {
  const nameOf = (to: string) =>
    to === group
      ? 'WhatsApp-Gruppe'
      : (view.participants.find((entry) => entry.member.phone === to)?.member.name ??
        (view.host?.phone === to ? view.host.name : '?'));
  const lines = new Map<string, MessagePreview>();
  for (const message of planned) {
    const kind = MESSAGE_KINDS[message.key.split(':')[0]!] ?? message.key;
    const id = `${message.at.getTime()}|${kind}`;
    const line = lines.get(id) ?? { at: message.at, kind, recipients: [] };
    const name = nameOf(message.to);
    if (!line.recipients.includes(name)) line.recipients.push(name);
    lines.set(id, line);
  }
  return [...lines.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}
