import { berlinAt, daysBetween, todayIso, type IsoDate } from '@/lib/dates';
import { formatDayShort, formatEuro, formatTime } from '@/lib/format';
import { buildOrderSheet, orderSheetText } from '@/lib/order-sheet';
import { paypalMeLink } from '@/lib/paypal';
import type { FridayView, Participant } from '@/lib/services/fridays';

export type Outgoing = { key: string; to: string; text: string };

const PAY_REMINDER_DAYS = 10;

type Input = {
  view: FridayView;
  now: Date;
  appUrl: string;
  /** Default dish name per member for this Friday's restaurant. */
  defaultDish: Map<number, string>;
  /** Group chat to announce in, if one is configured. */
  group: string | null;
};

function between(now: Date, from: Date, to: Date) {
  return now >= from && now < to;
}

function fridayLink(appUrl: string, date: IsoDate) {
  return `${appUrl}/freitag/${date}`;
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
export function planReminders({ view, now, appUrl, defaultDish, group }: Input): Outgoing[] {
  const out: Outgoing[] = [];
  const date = view.date;
  const day = formatDayShort(date);
  const link = fridayLink(appUrl, date);
  const members = view.participants.filter(
    (entry) => entry.member.kind === 'member' && entry.member.active && entry.member.phone
  );
  const what =
    view.mode === 'flat'
      ? `gibt's ${view.flatTitle ?? 'was Leckeres'} für ${formatEuro(view.flatPriceCents ?? 0)} pro Person`
      : view.restaurant
        ? `bestellen wir bei ${view.restaurant.name}`
        : 'bestellen wir zusammen (Restaurant kommt noch)';
  const host = view.host?.name ?? 'uns';
  const inviteWindow = [berlinAt(date, -2, 12), berlinAt(date, 0, 17)] as const;

  if (view.cancelled) {
    if (between(now, inviteWindow[0], view.deadline)) {
      const text = `Freitag (${day}) fällt aus${view.cancelReason ? `: ${view.cancelReason}` : '.'}`;
      for (const entry of members)
        out.push({ key: `cancel:${date}:${entry.member.id}`, to: entry.member.phone!, text });
      if (group) out.push({ key: `cancel:${date}:group`, to: group, text });
    }
    return out;
  }

  if (between(now, ...inviteWindow)) {
    for (const entry of members) {
      if (entry.attendance.reason !== 'silent') continue;
      out.push({
        key: `invite:${date}:${entry.member.id}`,
        to: entry.member.phone!,
        text: `Hi ${entry.member.name}! Freitag (${day}) ${what}, bei ${host}.\nBist du dabei? ${ANSWER_HINT}\n\nWer nichts sagt, ist dabei.\n${link}`,
      });
    }
    if (group) {
      out.push({
        key: `invite:${date}:group`,
        to: group,
        text: `Freitag (${day}) ${what}, bei ${host}. Bestellschluss ${formatTime(view.deadline)}.\n${link}`,
      });
    }
  }

  const eatsWithoutOrder = (entry: Participant) =>
    entry.attendance.status === 'in' &&
    entry.items.length === 0 &&
    entry.member.id !== view.host?.id;
  if (view.mode === 'delivery' && view.restaurant && !view.locked) {
    const remind = (key: string, intro: string) => {
      for (const entry of members.filter(eatsWithoutOrder)) {
        const fallback = defaultDish.get(entry.member.id);
        out.push({
          key: `${key}:${date}:${entry.member.id}`,
          to: entry.member.phone!,
          text: `${intro} Bis ${formatTime(view.deadline)} kannst du bei ${view.restaurant!.name} bestellen, sonst ${
            fallback ? `bekommst du deinen Standard (${fallback})` : 'gibt’s für dich nichts'
          }.\n${link}`,
        });
      }
    };
    if (between(now, berlinAt(date, 0, 17), view.deadline))
      remind('order', 'Du hast für heute Abend noch nichts ausgesucht.');
    if (between(now, berlinAt(date, 0, 18, 30), view.deadline))
      remind('lastcall', 'Letzte Chance!');
  }

  if (between(now, berlinAt(date, 0, 18, 30), view.deadline)) {
    for (const entry of members) {
      if (entry.money.openCents <= 0 || entry.member.id === view.host?.id) continue;
      out.push({
        key: `prepay:${date}:${entry.member.id}`,
        to: entry.member.phone!,
        text: `Für heute Abend sind bei dir ${formatEuro(entry.money.openCents)} offen. Am besten gleich zahlen:\n${payLine(view, entry.money.openCents)}\nDanach antworte mit „bezahlt“.`,
      });
    }
  }

  if (
    view.locked &&
    view.host?.phone &&
    between(now, view.deadline, new Date(view.deadline.getTime() + 3 * 3_600_000))
  ) {
    const eating = view.participants.filter((entry) => entry.attendance.status === 'in').length;
    const text =
      view.mode === 'flat'
        ? `Anmeldeschluss: ${eating} Leute sind dabei.\n${link}`
        : `Bestellschluss! Das geht an ${view.restaurant?.name ?? 'das Restaurant'}:\n\n${
            orderSheetText(
              buildOrderSheet(
                view.participants.flatMap((entry) => entry.items),
                (id) =>
                  view.participants.find((entry) => entry.member.id === id)?.member.name ?? '?'
              )
            ) || 'Niemand hat etwas bestellt.'
          }\n\nNach der Bestellung den Betrag hier eintragen: ${link}`;
    out.push({ key: `sheet:${date}`, to: view.host.phone, text });
  }

  const billed = view.mode === 'flat' ? view.locked : view.settled;
  if (billed) {
    const today = todayIso(now);
    const dayOffset = daysBetween(date, today);
    const reminderWindow = [
      berlinAt(date, dayOffset, 18),
      berlinAt(date, dayOffset + 1, 0),
    ] as const;
    for (const entry of members) {
      const open = entry.money.openCents;
      if (open === 0 || entry.member.id === view.host?.id) continue;
      if (view.mode === 'delivery' && dayOffset <= 7) {
        out.push({
          key: `settled:${date}:${entry.member.id}:${view.finalTotalCents}`,
          to: entry.member.phone!,
          text:
            open > 0
              ? `Abgerechnet: Bei dir sind noch ${formatEuro(open)} offen.\n${payLine(view, open)}\nDanach antworte mit „bezahlt“.`
              : `Abgerechnet: Du hast ${formatEuro(-open)} zu viel gezahlt, ${host} gibt dir das zurück.`,
        });
      }
      if (
        open > 0 &&
        dayOffset >= 1 &&
        dayOffset <= PAY_REMINDER_DAYS &&
        between(now, ...reminderWindow)
      ) {
        out.push({
          key: `pay:${date}:${entry.member.id}:${today}`,
          to: entry.member.phone!,
          text: `Kleine Erinnerung: Für Freitag (${day}) sind bei dir noch ${formatEuro(open)} offen.\n${payLine(view, open)}\nWenn du schon gezahlt hast, antworte mit „bezahlt“.`,
        });
      }
    }
  }

  return out;
}
