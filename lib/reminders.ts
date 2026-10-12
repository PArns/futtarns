import { berlinAt, daysBetween, todayIso } from '@/lib/dates';
import { formatDayShort, formatEuro, formatTime } from '@/lib/format';
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
};

function between(now: Date, from: Date, to: Date) {
  return now >= from && now < to;
}

function payLine(view: FridayView, cents: number) {
  const handle = view.host?.paypalMe;
  return handle
    ? `${paypalMeLink(handle, cents)} (bitte als „Freunde und Familie“)`
    : `Bitte direkt an ${view.host?.name ?? 'den Gastgeber'} zahlen.`;
}

const ANSWER_HINT = 'Antworte mit\n1 – bin dabei\n2 – komme, esse aber nix\n3 – bin raus';

/**
 * Every WhatsApp message one Friday calls for at `now`. Each message has a key; the
 * scheduler sends a key once, so this can run every minute. Every window ends, so a
 * container that was down does not send yesterday's reminders.
 */
export function planReminders({ view, now, appUrl, defaultDish, group, sent }: Input): Outgoing[] {
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
      const text = `Freitag (${day}) fällt aus${view.cancelReason ? `: ${view.cancelReason}` : '.'}`;
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
          text: `Freitag (${day}) bist du weg, stehst aber als Gastgeber drin. Trag ein, wer übernimmt, oder sag den Freitag ab:\n${appUrl}/kalender`,
        });
      }
    }
  }

  const noRestaurant = !flat && !view.restaurant;
  if (noRestaurant && hostPhone) {
    for (const [key, at] of [
      ['thu', berlinAt(date, -1, 18)],
      ['fri', berlinAt(date, 0, 12)],
    ] as const) {
      if (between(now, at, view.deadline)) {
        out.push({
          key: `pick:${date}:${key}`,
          to: hostPhone,
          text: `Für Freitag (${day}) steht noch kein Restaurant fest. Such eins aus, dann können alle bestellen:\n${link}`,
        });
      }
    }
  }

  // Invitations wait until Thursday noon for a restaurant; after that they go out anyway
  // and a second message follows once it is chosen.
  const inviteFrom = noRestaurant ? berlinAt(date, -1, 12) : berlinAt(date, -2, 12);
  if (between(now, inviteFrom, berlinAt(date, 0, 17))) {
    const what = flat
      ? `gibt's ${view.flatTitle ?? 'was Leckeres'} für ${formatEuro(view.flatPriceCents ?? 0)} pro Person`
      : view.restaurant
        ? `bestellen wir bei ${view.restaurant.name}`
        : 'bestellen wir zusammen (Restaurant kommt noch)';
    const rule = flat ? 'Dafür brauchen wir deine Zusage.' : 'Wer nichts sagt, ist dabei.';
    for (const entry of reachable) {
      if (entry.attendance.reason !== 'silent' || entry.member.id === view.host?.id) continue;
      const id = entry.member.id;
      if (sent.has(`invite:${date}:${id}`) || sent.has(`invite-open:${date}:${id}`)) continue;
      out.push({
        key: `${noRestaurant ? 'invite-open' : 'invite'}:${date}:${id}`,
        to: entry.member.phone!,
        text: `Hi ${entry.member.name}! Freitag (${day}) ${what}${place}.\nBist du dabei? ${ANSWER_HINT}\n\n${rule}\n${link}`,
      });
    }
    if (group && !sent.has(`invite:${date}:group`)) {
      out.push({
        key: `invite:${date}:group`,
        to: group,
        text: `Freitag (${day}) ${what}${place}. ${flat ? 'Anmeldeschluss' : 'Bestellschluss'} ist um ${formatTime(view.deadline)}.\n${link}`,
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
        text: `Für Freitag steht es fest: ${restaurant.name}. Such dir bis ${formatTime(view.deadline)} was aus:\n${link}`,
      });
    }

    const remind = (key: string, intro: string, onlyWithoutDefault: boolean) => {
      for (const entry of reachable.filter(eatsWithoutOrder)) {
        const fallback = defaultDish.get(entry.member.id);
        if (onlyWithoutDefault && fallback) continue;
        out.push({
          key: `${key}:${date}:${entry.member.id}`,
          to: entry.member.phone!,
          text: `${intro} Bis ${formatTime(view.deadline)} kannst du bei ${restaurant.name} bestellen, sonst ${
            fallback ? `bekommst du deinen Standard (${fallback})` : 'gibt’s für dich nichts'
          }.\n${link}`,
        });
      }
    };
    // Whoever has a default gets one reminder; the rest a second, since they would go hungry.
    if (between(now, berlinAt(date, 0, 17), view.deadline)) {
      remind('order', 'Du hast für heute Abend noch nichts ausgesucht.', false);
    }
    if (between(now, berlinAt(date, 0, 18, 30), view.deadline)) {
      remind('lastcall', 'Letzte Chance!', true);
    }
  }

  if (between(now, berlinAt(date, 0, 18, 30), view.deadline)) {
    for (const entry of view.participants) {
      if (entry.money.openCents < NAG_THRESHOLD_CENTS || entry.member.id === view.host?.id)
        continue;
      const { phone, prefix } = billTo(entry);
      if (!phone) continue;
      out.push({
        key: `prepay:${date}:${entry.member.id}`,
        to: phone,
        text: `${prefix}Für heute Abend sind ${formatEuro(entry.money.openCents)} offen. Am besten gleich zahlen:\n${payLine(view, entry.money.openCents)}\nDanach antworte mit „bezahlt“.`,
      });
    }
  }

  const sheetUntil = new Date(view.deadline.getTime() + 3 * 3_600_000);
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
        ? `Anmeldeschluss: ${eating} Leute sind dabei.\n${link}`
        : `Bestellschluss! Das geht an ${view.restaurant?.name ?? 'das Restaurant'}:\n\n${
            sheet || 'Niemand hat etwas bestellt.'
          }\n\nNach der Bestellung den Betrag hier eintragen: ${link}`,
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
        text: `Was hat Freitag (${day}) bei Lieferando gekostet? Trag den Betrag ein, dann bekommen alle ihre Abrechnung:\n${link}`,
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
              ? `${prefix}Abgerechnet: Noch ${formatEuro(open)} offen.\n${payLine(view, open)}\nDanach antworte mit „bezahlt“.`
              : `${prefix}Abgerechnet: ${formatEuro(-open)} zu viel gezahlt, ${host} gibt das zurück.`,
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
          text: `${prefix}Kleine Erinnerung: Für Freitag (${day}) sind noch ${formatEuro(open)} offen.\n${payLine(view, open)}\nWenn schon gezahlt, antworte mit „bezahlt“.`,
        });
      }
    }
  }

  return out;
}
