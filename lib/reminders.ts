import { shareLines } from '@/lib/balance';
import { berlinAt, daysBetween, todayIso } from '@/lib/dates';
import { formatDayShort, formatEuro, formatTime } from '@/lib/format';
import { bold } from '@/lib/messages';
import { buildOrderSheet, orderSheetText } from '@/lib/order-sheet';
import { paypalMeLink } from '@/lib/paypal';
import type { FridayView, Participant } from '@/lib/services/fridays';

export type Outgoing = { key: string; to: string; text: string };

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

function payLines(view: FridayView, cents: number) {
  const handle = view.host?.paypalMe;
  return handle
    ? `PayPal: ${paypalMeLink(handle, cents)}\nBitte als „Freunde und Familie“.`
    : `Bitte direkt an ${view.host?.name ?? 'den Gastgeber'} zahlen.`;
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

  // The invitation goes out on the Friday morning. Without a restaurant by then it goes out
  // anyway, and a second message follows once one is chosen.
  if (between(now, berlinAt(date, 0, 10), berlinAt(date, 0, 17))) {
    const what = flat
      ? `gibt's ${view.flatTitle ?? 'was Leckeres'} für ${formatEuro(view.flatPriceCents ?? 0)} pro Person`
      : view.restaurant
        ? `bestellen wir bei ${view.restaurant.name}`
        : 'bestellen wir zusammen (Restaurant kommt noch)';
    const rule = flat ? 'Dafür brauchen wir deine Zusage.' : 'Wer nichts sagt, ist dabei.';
    // Silent members count as in, so the invitation also carries the order reminder.
    const orderHint = (memberId: number) =>
      !flat && view.restaurant
        ? `\nSuch dir bis ${bold(deadline)} was aus, sonst ${orderFallback(memberId)}.`
        : '';
    for (const entry of reachable) {
      if (entry.attendance.reason !== 'silent' || entry.member.id === view.host?.id) continue;
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
      if (open < NAG_THRESHOLD_CENTS || entry.member.id === view.host?.id) continue;
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
          payLines(view, open),
          ...(flat ? [] : ['Kleine Abweichungen gleichen wir nach der Abrechnung aus.']),
          '',
          `Schon gezahlt? Hier abhaken:\n${paidLink(entry.member.id)}`,
        ].join('\n'),
      });
    }
  }

  if (view.locked && hostPhone && between(now, view.deadline, sheetUntil)) {
    const eating = view.participants.filter((entry) => entry.attendance.status === 'in').length;
    const sheet = orderSheetText(
      buildOrderSheet(
        view.participants.flatMap((entry) => entry.items),
        (id) => view.participants.find((entry) => entry.member.id === id)?.member.name ?? '?'
      )
    );
    out.push({
      key: `sheet:${date}`,
      to: hostPhone,
      text: flat
        ? `${bold('Anmeldeschluss:')} ${eating} Leute sind dabei.\n${link}`
        : `${bold('Bestellschluss!')} Das geht an ${bold(view.restaurant?.name ?? 'das Restaurant')}:\n\n${
            sheet || 'Niemand hat etwas bestellt.'
          }${
            view.voucherCents
              ? `\n\n${bold('Gutschein einlösen:')} ${formatEuro(view.voucherCents)}`
              : ''
          }\n\nNach der Bestellung den Betrag hier eintragen:\n${link}`,
    });
  }

  const today = todayIso(now);
  const dayOffset = daysBetween(date, today);
  const morning = [berlinAt(date, dayOffset, 10), berlinAt(date, dayOffset + 1, 0)] as const;
  const evening = [berlinAt(date, dayOffset, 18), berlinAt(date, dayOffset + 1, 0)] as const;
  const hasOrders = view.participants.some((entry) => entry.items.length > 0);

  if (!flat && view.locked && !view.settled && hasOrders && hostPhone) {
    if (dayOffset >= 1 && dayOffset <= SETTLE_REMINDER_DAYS && between(now, ...morning)) {
      out.push({
        key: `settle:${date}:${today}`,
        to: hostPhone,
        text: `${bold(`Was hat Freitag (${day}) bei Lieferando gekostet?`)}\nTrag den Betrag ein, dann bekommen alle ihre Abrechnung:\n${link}`,
      });
    }
  }

  const billed = flat ? view.locked : view.settled;
  if (billed) {
    for (const entry of view.participants) {
      const open = entry.money.openCents;
      if (Math.abs(open) < NAG_THRESHOLD_CENTS || entry.member.id === view.host?.id) continue;
      const { phone, prefix } = billTo(entry);
      if (!phone) continue;
      if (!flat && dayOffset <= 7) {
        out.push({
          key: `settled:${date}:${entry.member.id}:${view.finalTotalCents}`,
          to: phone,
          text:
            open > 0
              ? `${prefix}${bold('Abgerechnet:')} noch ${bold(formatEuro(open))} offen.\n\n${payLines(view, open)}\n\nSchon gezahlt? Hier abhaken:\n${paidLink(entry.member.id)}`
              : `${prefix}${bold('Abgerechnet:')} ${bold(formatEuro(-open))} zu viel gezahlt, ${host} gibt das zurück.`,
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
          text: `${prefix}${bold('Kleine Erinnerung:')} Für Freitag (${day}) sind noch ${bold(formatEuro(open))} offen.\n\n${payLines(view, open)}\n\nSchon gezahlt? Hier abhaken, dann hören die Erinnerungen auf:\n${paidLink(entry.member.id)}`,
        });
      }
    }
  }

  return out;
}
