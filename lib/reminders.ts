import { isBilled, payeeOf, payeePurpose, payeesFor, shareLines, type Money } from '@/lib/balance';
import { berlinAt, daysBetween, todayIso } from '@/lib/dates';
import { formatDayShort, formatEuro, formatTime } from '@/lib/format';
import { bold } from '@/lib/messages';
import { buildOrderSheet, orderSheetText } from '@/lib/order-sheet';
import { paypalMeLink } from '@/lib/paypal';
import type { FridayView, Participant } from '@/lib/services/fridays';

export type Outgoing = { key: string; to: string; text: string };

/** How often the scheduler runs (`instrumentation.ts`). */
export const SCHEDULER_INTERVAL_MS = 60_000;
const PAY_REMINDER_DAYS = 10;
const SETTLE_REMINDER_DAYS = 3;
/** Differences below this are not worth a message; they show on the page all the same. */
export const NAG_THRESHOLD_CENTS = 50;

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
  if (payees.some((payee) => payee.paypalMe)) lines.push('Bitte als „Freunde und Familie“.');
  return lines.join('\n');
}

const ANSWER_HINT = [
  'Bist du dabei? Antworte mit',
  `${bold('1')} – bin dabei`,
  `${bold('2')} – komme, esse aber nix`,
  `${bold('3')} – bin raus`,
].join('\n');

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
}: Input): Outgoing[] {
  const out: Outgoing[] = [];
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
      const text = [bold(`Freitag (${day}) fällt aus.`), view.cancelReason]
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
          text: `${bold(`Freitag (${day}) bist du weg`)}, stehst aber als Gastgeber drin.\nTrag ein, wer übernimmt, oder sag den Freitag ab:\n${appUrl}/kalender`,
        });
      }
    }
  }

  const noRestaurant = !flat && !view.restaurant;
  if (noRestaurant && hostPhone) {
    for (const [key, at] of [
      ['thu', berlinAt(date, -1, 18)],
      // An hour before the invitations, so they can already name the restaurant.
      ['fri', berlinAt(date, 0, 9)],
    ] as const) {
      if (between(now, at, view.deadline)) {
        out.push({
          key: `pick:${date}:${key}`,
          to: hostPhone,
          text: `${bold(`Für Freitag (${day}) steht noch kein Restaurant fest.`)}\nSuch eins aus, dann können alle bestellen:\n${link}`,
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
    : view.restaurant
      ? `bestellen wir bei ${view.restaurant.name}${view.picker ? ` (${view.picker.name} holt ab)` : ''}`
      : 'bestellen wir zusammen (Restaurant kommt noch)';
  const rule = flat ? 'Dafür brauchen wir deine Zusage.' : 'Wer nichts sagt, ist dabei.';
  const unanswered = reachable.filter(
    (entry) => entry.attendance.reason === 'silent' && entry.member.id !== view.host?.id
  );

  // On Wednesday, once it is clear the Friday happens, a first question who comes; whoever
  // still has not answered gets the invitation on Friday.
  if (between(now, berlinAt(date, -2, 12), berlinAt(date, 0, 10))) {
    for (const entry of unanswered) {
      out.push({
        key: `ask:${date}:${entry.member.id}`,
        to: entry.member.phone!,
        text: `Hi ${entry.member.name}! 👋\n${bold(`Am Freitag (${day}) ${what}`)}${place}.\n\n${ANSWER_HINT}\n\n${rule}\n${link}`,
      });
    }
  }

  // The invitation goes out on the Friday morning. Without a restaurant by then it goes out
  // anyway, and a second message follows once one is chosen.
  if (between(now, berlinAt(date, 0, 10), berlinAt(date, 0, 17))) {
    // Silent members count as in, so the invitation also carries the order reminder.
    const orderHint = (memberId: number) =>
      !flat && view.restaurant
        ? `\nSuch dir bis ${bold(deadline)} was aus, sonst ${orderFallback(memberId)}.`
        : '';
    for (const entry of unanswered) {
      const id = entry.member.id;
      if (invited(id)) continue;
      out.push({
        key: `${noRestaurant ? 'invite-open' : 'invite'}:${date}:${id}`,
        to: entry.member.phone!,
        text: `Hi ${entry.member.name}! 👋\n${bold(`Heute ${what}`)}${place}.\n\n${ANSWER_HINT}\n\n${rule}${orderHint(id)}\n${link}`,
      });
    }
    if (group && !sent.has(`invite:${date}:group`)) {
      out.push({
        key: `invite:${date}:group`,
        to: group,
        text: `${bold(`Heute ${what}`)}${place}.\n${flat ? 'Anmeldeschluss' : 'Bestellschluss'}: ${bold(deadline)}\n${link}`,
      });
    }
  }

  const eatsWithoutOrder = (entry: Participant) =>
    entry.attendance.status === 'in' &&
    entry.items.length === 0 &&
    entry.member.id !== view.host?.id;

  if (!flat && view.restaurant && !view.locked && now < view.deadline) {
    const restaurant = view.restaurant;
    for (const entry of reachable.filter(eatsWithoutOrder)) {
      if (!sent.has(`invite-open:${date}:${entry.member.id}`)) continue;
      out.push({
        key: `restaurant:${date}:${restaurant.id}:${entry.member.id}`,
        to: entry.member.phone!,
        text: `Für heute steht es fest: ${bold(restaurant.name)}.\nSuch dir bis ${bold(deadline)} was aus:\n${link}`,
      });
    }

    const remind = (key: string, intro: string, entries: Participant[]) => {
      for (const entry of entries) {
        out.push({
          key: `${key}:${date}:${entry.member.id}`,
          to: entry.member.phone!,
          text: `${intro}\nBis ${bold(deadline)} kannst du bei ${bold(restaurant.name)} bestellen, sonst ${orderFallback(entry.member.id)}.\n${link}`,
        });
      }
    };
    const withoutOrder = reachable.filter(eatsWithoutOrder);
    // Friday morning, for whoever said yes without the invitation, which already asked them
    // to pick something.
    if (between(now, berlinAt(date, 0, 10), view.deadline)) {
      remind(
        'order',
        'Du hast für heute Abend noch nichts ausgesucht.',
        withoutOrder.filter(
          (entry) => entry.attendance.reason === 'answered' && !invited(entry.member.id)
        )
      );
    }
    // Whoever has no default would go hungry, so they hear once more.
    if (between(now, berlinAt(date, 0, 18, 30), view.deadline)) {
      remind(
        'lastcall',
        bold('Letzte Chance!'),
        withoutOrder.filter((entry) => !defaultDish.has(entry.member.id))
      );
    }
  }

  const sheetUntil = new Date(view.deadline.getTime() + 3 * 3_600_000);
  // Paying opens with the deadline: before it, orders and with them the shares still change.
  if (view.locked && between(now, view.deadline, sheetUntil)) {
    for (const entry of view.participants) {
      const open = entry.money.openCents;
      if (open < NAG_THRESHOLD_CENTS) continue;
      const { phone, prefix } = billTo(entry);
      if (!phone) continue;
      out.push({
        key: `due:${date}:${entry.member.id}`,
        to: phone,
        text: [
          `${prefix}${bold(flat ? 'Anmeldeschluss!' : 'Bestellschluss!')} Für heute Abend sind ${bold(formatEuro(open))} offen.`,
          '',
          ...shareLines(view, entry).map((line) => `${line.label}: ${formatEuro(line.cents)}`),
          '',
          payLines(view, entry.money),
          ...(flat || view.pickup
            ? []
            : ['Kleine Abweichungen gleichen wir nach der Abrechnung aus.']),
          '',
          `Schon gezahlt? Hier abhaken:\n${paidLink(entry.member.id)}`,
        ].join('\n'),
      });
    }
  }

  // The order list goes to whoever orders: the host, or whoever fetches the food.
  const ordererPhone = view.picker ? view.picker.phone : hostPhone;
  if (view.locked && ordererPhone && between(now, view.deadline, sheetUntil)) {
    const eating = view.participants.filter((entry) => entry.attendance.status === 'in').length;
    const sheet = orderSheetText(
      buildOrderSheet(
        view.participants.flatMap((entry) => entry.items),
        (id) => view.participants.find((entry) => entry.member.id === id)?.member.name ?? '?'
      )
    );
    const restaurant = bold(view.restaurant?.name ?? 'das Restaurant');
    const lieferando = view.restaurant?.lieferandoUrl;
    out.push({
      key: `sheet:${date}`,
      to: ordererPhone,
      text: flat
        ? `${bold('Anmeldeschluss:')} ${eating} Leute sind dabei.\n${link}`
        : [
            `${bold('Bestellschluss!')} ${view.pickup ? `Zum Abholen bei ${restaurant}` : `Das geht an ${restaurant}`}:`,
            '',
            sheet || 'Niemand hat etwas bestellt.',
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

  const today = todayIso(now);
  const dayOffset = daysBetween(date, today);
  const morning = [berlinAt(date, dayOffset, 10), berlinAt(date, dayOffset + 1, 0)] as const;
  const evening = [berlinAt(date, dayOffset, 18), berlinAt(date, dayOffset + 1, 0)] as const;
  const hasOrders = view.participants.some((entry) => entry.items.length > 0);
  const refundFrom = (money: Money) =>
    payeeOf(view, money.debts.find((debt) => debt.openCents < 0) ?? { payeeId: null })?.name ??
    host;

  // Fetched food costs the menu prices, so there is no real total to ask for.
  if (!flat && !view.pickup && view.locked && !view.settled && hasOrders && hostPhone) {
    if (dayOffset >= 1 && dayOffset <= SETTLE_REMINDER_DAYS && between(now, ...morning)) {
      out.push({
        key: `settle:${date}:${today}`,
        to: hostPhone,
        text: `${bold(`Was hat Freitag (${day}) bei Lieferando gekostet?`)}\nTrag den Betrag ein, dann bekommen alle ihre Abrechnung:\n${link}`,
      });
    }
  }

  if (isBilled(view)) {
    for (const entry of view.participants) {
      const open = entry.money.openCents;
      if (Math.abs(open) < NAG_THRESHOLD_CENTS) continue;
      const { phone, prefix } = billTo(entry);
      if (!phone) continue;
      if (view.settled && !flat && dayOffset <= 7) {
        out.push({
          key: `settled:${date}:${entry.member.id}:${view.finalTotalCents}`,
          to: phone,
          text:
            open > 0
              ? `${prefix}${bold('Abgerechnet:')} noch ${bold(formatEuro(open))} offen.\n\n${payLines(view, entry.money)}\n\nSchon gezahlt? Hier abhaken:\n${paidLink(entry.member.id)}`
              : `${prefix}${bold('Abgerechnet:')} ${bold(formatEuro(-open))} zu viel gezahlt, ${refundFrom(entry.money)} gibt das zurück.`,
        });
      }
      if (
        open > 0 &&
        dayOffset >= 1 &&
        dayOffset <= PAY_REMINDER_DAYS &&
        between(now, ...evening)
      ) {
        out.push({
          key: `pay:${date}:${entry.member.id}:${today}`,
          to: phone,
          text: `${prefix}${bold('Kleine Erinnerung:')} Für Freitag (${day}) sind noch ${bold(formatEuro(open))} offen.\n\n${payLines(view, entry.money)}\n\nSchon gezahlt? Hier abhaken, dann hören die Erinnerungen auf:\n${paidLink(entry.member.id)}`,
        });
      }
    }
  }

  return out;
}

/**
 * The moments ahead at which `planReminders` sends something new for this Friday: the
 * scheduler's next pass (for whatever is due right away), each window that opens up to the
 * deadline, and the next morning and evening after it. Settle and pay reminders repeat
 * daily, so the overview shows the next one of each.
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
    new Date(now.getTime() + SCHEDULER_INTERVAL_MS),
    berlinAt(date, -4, 18),
    berlinAt(date, -2, 10),
    berlinAt(date, -2, 12),
    berlinAt(date, -1, 18),
    berlinAt(date, 0, 9),
    berlinAt(date, 0, 10),
    berlinAt(date, 0, 18, 30),
    view.deadline,
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
export function previewReminders(input: Omit<Input, 'now'>, now: Date): PlannedMessage[] {
  const planned = new Map<string, PlannedMessage>();
  const locked = { ...input.view, locked: true };
  for (const at of previewTimes(input.view, now)) {
    const view = at >= input.view.deadline && !input.view.cancelled ? locked : input.view;
    for (const message of planReminders({ ...input, view, now: at })) {
      if (!input.sent.has(message.key) && !planned.has(message.key)) {
        planned.set(message.key, { ...message, at });
      }
    }
  }
  return [...planned.values()];
}

const MESSAGE_KINDS: Record<string, string> = {
  cancel: 'Absage',
  hostaway: 'Gastgeber ist weg, wer übernimmt?',
  pick: 'Restaurant aussuchen',
  ask: 'Kommst du?',
  invite: 'Einladung',
  'invite-open': 'Einladung',
  restaurant: 'Restaurant steht fest',
  order: 'Noch nichts ausgesucht',
  lastcall: 'Letzte Chance',
  due: 'Betrag und Zahl-Link',
  sheet: 'Bestellliste',
  settle: 'Was hat es gekostet?',
  settled: 'Abrechnung',
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
