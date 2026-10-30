import { and, count, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { menuLines, type Research } from '@/lib/assistant';
import { appUrl } from '@/lib/auth-tokens';
import {
  addWeeks,
  currentFriday,
  deliveryTime,
  todayIso,
  isFridayIso,
  isPastDeadline,
  type IsoDate,
} from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import {
  appSecrets,
  dishes,
  memberDefaults,
  orderItems,
  restaurants,
  type Dish,
  type Member,
} from '@/lib/db/schema';
import { formatDayShort, formatEuro, formatTime, formatWeekdayTime } from '@/lib/format';
import { canManageFriday } from '@/lib/permissions';
import {
  getFridayRow,
  loadCalendar,
  loadFriday,
  openBalancesFor,
  paymentOpen,
  type FridayView,
} from '@/lib/services/fridays';
import { listDishes, restaurantsForHost } from '@/lib/services/restaurants';
import { tally, VOTE_CLOSE_HOUR, voteEndsText, voteLetter, votingAt } from '@/lib/vote';

/** Where the Claude API key an admin entered is kept. */
const KEY_NAME = 'anthropic_api_key';

/** The key the assistant uses: the one an admin entered, else `ANTHROPIC_API_KEY`. */
export async function getAssistantKey(db: Db): Promise<string | null> {
  const [row] = await db.select().from(appSecrets).where(eq(appSecrets.name, KEY_NAME));
  return row?.value || process.env.ANTHROPIC_API_KEY || null;
}

/** Which key is in use, as admins may see it: where it comes from and its last characters. */
export async function assistantKeyInfo(
  db: Db
): Promise<{ source: 'app' | 'env' | null; ending: string | null }> {
  const [row] = await db.select().from(appSecrets).where(eq(appSecrets.name, KEY_NAME));
  const key = row?.value || process.env.ANTHROPIC_API_KEY || null;
  return {
    source: row?.value ? 'app' : key ? 'env' : null,
    ending: key ? key.slice(-4) : null,
  };
}

export async function setAssistantKey(db: Db, key: string) {
  await db
    .insert(appSecrets)
    .values({ name: KEY_NAME, value: key })
    .onConflictDoUpdate({ target: appSecrets.name, set: { value: key } });
}

export async function clearAssistantKey(db: Db) {
  await db.delete(appSecrets).where(eq(appSecrets.name, KEY_NAME));
}

/** At most this many earlier Fridays of someone's orders go into the facts. */
const PAST_FRIDAYS = 12;

/** Restaurants named in the message whose menus also go in, for advice or ordering. */
const MENTIONED_MENUS = 2;

const STATUS = { in: 'dabei', nofood: 'kommt ohne Essen', out: 'raus' } as const;

/**
 * Why someone would be reminded on request: no answer yet, or coming to eat with nothing
 * picked and no default to fall back on; null when there is nothing for them to do.
 */
export function nudgeReason(
  view: FridayView,
  entry: FridayView['participants'][number]
): 'unanswered' | 'no_order' | null {
  if (entry.attendance.reason === 'silent') return 'unanswered';
  return view.mode === 'delivery' &&
    entry.attendance.status === 'in' &&
    entry.items.length === 0 &&
    !entry.projectedDefault &&
    entry.member.id !== view.host?.id
    ? 'no_order'
    : null;
}

/** Whether a message names a restaurant: its whole name, or one of its longer words. */
export function mentions(text: string, name: string): boolean {
  const said = text.toLowerCase();
  const lower = name.toLowerCase();
  return (
    said.includes(lower) ||
    lower.split(/[^\p{L}\p{N}]+/u).some((word) => word.length >= 5 && said.includes(word))
  );
}

/**
 * The Friday's phases as the page's phase bar shows them (Wahl, Bestellen, Essen, Zahlen),
 * the current one marked, and what happens in it.
 */
function phaseLines(view: FridayView, voting: boolean, now: Date): string[] {
  if (view.cancelled) return ['Der Freitag fällt aus.'];
  const flat = view.mode === 'flat';
  const ordering = !view.locked && !isPastDeadline(view.date, now);
  const paying = paymentOpen(view, now);
  const phases = [
    ...(voting || view.votes.length ? [{ name: 'Wahl', until: `bis ${VOTE_CLOSE_HOUR}:00` }] : []),
    { name: flat ? 'Anmelden' : 'Bestellen', until: `bis ${formatTime(view.deadline)}` },
    { name: 'Essen', until: flat ? '' : `gegen ${formatTime(deliveryTime(view.date))}` },
    { name: 'Zahlen', until: 'sobald der Gastgeber freigibt, spätestens am Morgen danach' },
  ];
  const current = voting
    ? 'Wahl'
    : ordering
      ? phases[phases.length - 3]!.name
      : paying
        ? 'Zahlen'
        : 'Essen';
  return [
    `Phasen: ${phases
      .map(
        (phase) =>
          `${phase.name}${phase.until ? ` (${phase.until})` : ''}${phase.name === current ? ' ← jetzt' : ''}`
      )
      .join(' → ')}`,
    voting
      ? `Jetzt: Restaurantwahl läuft bis ${voteEndsText(view.date, now)}, erst dann steht das Restaurant fest. Bestellen geht schon.`
      : ordering
        ? `Jetzt: ${flat ? 'Anmelden' : 'Bestellen'} läuft bis ${formatTime(view.deadline)}.`
        : paying
          ? 'Jetzt: Bezahlen läuft.'
          : `Jetzt: ${flat ? 'Anmeldeschluss' : 'Bestellschluss'} ist vorbei, ${flat ? 'der Abend läuft' : `${view.host?.name ?? 'der Gastgeber'} bestellt um ${formatTime(view.orderTime)}`}; bezahlt wird, sobald die Zahlung freigegeben ist.`,
  ];
}

/**
 * Everything Claude needs to read one member's message: this Friday, where it stands, their
 * own answer, order lines, vote and money, what they ate before, and the menus they can
 * order from; with `restaurantIds`, what they may settle as the restaurant. Only facts the
 * member could see on the page.
 */
export async function assistantFacts(
  db: Db,
  member: Member,
  text: string,
  now: Date
): Promise<{ facts: string; restaurantIds: Set<number> }> {
  const date = currentFriday(now);
  const view = await loadFriday(db, date, now);
  const flat = view.mode === 'flat';
  const options = await restaurantsForHost(db, view.host?.id ?? null);
  const voting = !flat && votingAt(view, now) && options.length > 1;
  const me = view.participants.find((entry) => entry.member.id === member.id);
  const nameOf = (id: number) =>
    view.participants.find((entry) => entry.member.id === id)?.member.name ?? '?';
  const myVote = view.votes.find((vote) => vote.memberId === member.id)?.restaurantId ?? null;
  const open = !view.cancelled && !view.locked && !isPastDeadline(date, now);

  const lines = [
    `Jetzt: ${formatWeekdayTime(now)} Uhr, ${todayIso(now)}`,
    `Link: ${appUrl()}/freitag/${date}`,
    `Freitag (${formatDayShort(date)}): ${
      view.host
        ? `bei ${view.host.name}${view.hostAbsent ? ' (ist an dem Tag weg, jemand muss übernehmen)' : ''}`
        : 'noch kein Gastgeber, jemand muss übernehmen'
    }`,
    ...phaseLines(view, voting, now),
  ];
  if (!view.cancelled) {
    if (flat) {
      lines.push(
        `Pauschale: ${view.flatTitle ?? 'Pauschale'}, ${formatEuro(view.flatPriceCents ?? 0)} pro Person.`
      );
    } else if (voting) {
      lines.push(
        `Wahl (Buchstabe · Restaurant · Stimmen):`,
        ...options.map((option, index) => {
          const voters = tally(options, view.votes).find(
            (entry) => entry.option.id === option.id
          )!.voterIds;
          return `${voteLetter(index)} · ${option.name}${option.cuisine ? ` (${option.cuisine})` : ''}${
            option.id === view.restaurant?.id ? ' 👑 bleibt ohne Stimmen' : ''
          }${option.delivers ? '' : ', nur abholen'} · ${voters.length}${voters.length ? ` (${voters.map(nameOf).join(', ')})` : ''}`;
        })
      );
    } else {
      lines.push(
        view.restaurant
          ? `Restaurant: ${view.restaurant.name} steht fest${view.pickup && view.picker ? `, ${view.picker.name} holt ab` : ''}.`
          : 'Restaurant: steht noch nicht fest.'
      );
    }
    lines.push(
      `Zeiten: ${flat ? 'Anmeldeschluss' : 'Bestellschluss'} ${formatTime(view.deadline)}${
        flat
          ? ''
          : `, Bestellung ${formatTime(view.orderTime)}, Essen gegen ${formatTime(deliveryTime(date))}`
      }.`,
      `Wer kommt: ${
        view.participants
          .filter((entry) => entry.attendance.status !== 'out')
          .map(
            (entry) =>
              `${entry.member.name}${entry.attendance.status === 'nofood' ? ' (ohne Essen)' : ''}`
          )
          .join(', ') || 'noch keiner'
      }.`
    );
  }
  const settles = canManageFriday(member, view.host?.id ?? null);
  lines.push(
    `Du bist ${member.name}: ${
      member.isAdmin
        ? 'Admin'
        : view.host?.id === member.id
          ? 'Gastgeber dieses Freitags'
          : member.core
            ? 'Stammtruppe'
            : 'Gast, nicht in der Stammtruppe'
    }. ${settles ? 'Du darfst das Restaurant für alle festlegen und Leute per Bot erinnern.' : 'Das Restaurant legen nur der Gastgeber und Admins fest, du stimmst ab; erinnern dürfen nur sie.'}`,
    `Restaurants (Nummer · Name · Küche): ${options
      .map(
        (option) =>
          `${option.id} · ${option.name}${option.cuisine ? ` · ${option.cuisine}` : ''}${option.delivers ? '' : ' · nur abholen'}`
      )
      .join('; ')}.`
  );
  if (settles && open) {
    lines.push(
      `Erinnern kannst du (Nummer · Name · Stand): ${
        view.participants
          .filter(
            (entry) =>
              entry.member.id !== member.id &&
              entry.member.kind === 'member' &&
              entry.attendance.reason !== 'absent' &&
              !(entry.attendance.reason === 'answered' && entry.attendance.status === 'out')
          )
          .map(
            (entry) =>
              `${entry.member.id} · ${entry.member.name} · ${nudgeReason(view, entry) === 'unanswered' ? 'keine Antwort' : nudgeReason(view, entry) === 'no_order' ? 'dabei, nichts ausgesucht' : STATUS[entry.attendance.status]}`
          )
          .join('; ') || 'keiner'
      }.`
    );
  }
  if (!view.cancelled && !flat) {
    const others = view.participants.filter(
      (entry) => entry.member.id !== member.id && entry.attendance.status !== 'out'
    );
    lines.push(
      `Wer was bestellt hat: ${
        others
          .map((entry) => {
            const ahead = view.preorders.filter((item) => item.memberId === entry.member.id);
            return `${entry.member.name}: ${
              entry.attendance.status === 'nofood'
                ? 'ohne Essen'
                : entry.items.map((item) => item.name).join(', ') ||
                  (entry.projectedDefault
                    ? `nichts ausgesucht, bekommt Standard ${entry.projectedDefault.name}`
                    : 'noch nichts')
            }${ahead.length ? ` (vorbestellt: ${ahead.map((item) => item.name).join(', ')})` : ''}`;
          })
          .join('; ') || 'noch keiner'
      }.`
    );
  }
  if (me && !view.cancelled) {
    lines.push(
      `Deine Antwort: ${STATUS[me.attendance.status]}${
        me.attendance.reason === 'silent'
          ? ' (ohne Antwort, so zählst du gerade)'
          : me.attendance.reason === 'absent'
            ? ' (als weg eingetragen)'
            : ''
      }${me.late ? `, kommt später${me.arrivesAt ? ` (~${me.arrivesAt})` : ''}` : ''}.`,
      `Deine Bestellung (Zeilennummer · Gericht): ${
        me.items.length
          ? me.items
              .map(
                (item) =>
                  `${item.id} · ${item.quantity > 1 ? `${item.quantity}× ` : ''}${item.name}${item.options.length ? ` (${item.options.map((option) => option.choiceName).join(', ')})` : ''}`
              )
              .join('; ')
          : me.projectedDefault
            ? `nichts ausgesucht, du bekommst deinen Standard ${me.projectedDefault.name}`
            : 'nichts'
      }.`
    );
    const ahead = view.preorders.filter((item) => item.memberId === member.id);
    if (ahead.length) {
      lines.push(
        `Vorbestellt (zählt nur, wenn das Restaurant gewinnt): ${ahead.map((item) => `${item.id} · ${item.name}`).join('; ')}.`
      );
    }
    if (voting) {
      lines.push(
        `Deine Stimme: ${myVote ? (options.find((option) => option.id === myVote)?.name ?? '?') : 'noch keine'}.`
      );
    }
    if (me.money.openCents !== 0) {
      lines.push(
        me.money.openCents > 0
          ? `Du zahlst ${paymentOpen(view, now) ? 'noch' : 'bis jetzt etwa'} ${formatEuro(me.money.openCents)}.`
          : `Du bekommst ${formatEuro(-me.money.openCents)} zurück.`
      );
    }
  } else if (!view.cancelled) {
    lines.push('Du bist an diesem Freitag nicht dabei, außer du sagst zu.');
  }

  // What they ate before and their defaults: the base for advice and „was ich sonst esse“.
  const past = await db
    .select({ date: orderItems.fridayDate, name: orderItems.name, restaurant: restaurants.name })
    .from(orderItems)
    .innerJoin(restaurants, eq(restaurants.id, orderItems.restaurantId))
    .where(and(eq(orderItems.memberId, member.id), lt(orderItems.fridayDate, date)))
    .orderBy(desc(orderItems.fridayDate))
    .limit(60);
  const byDate = [...Map.groupBy(past, (entry) => entry.date)].slice(0, PAST_FRIDAYS);
  lines.push(
    'Deine früheren Bestellungen:',
    ...(byDate.length
      ? byDate.map(
          ([day, items]: [IsoDate, typeof past]) =>
            `${formatDayShort(day)} ${items[0]!.restaurant}: ${items.map((item) => item.name).join(', ')}`
        )
      : ['keine'])
  );
  const defaults = await db
    .select({ restaurant: restaurants.name, dish: dishes.name })
    .from(memberDefaults)
    .innerJoin(restaurants, eq(restaurants.id, memberDefaults.restaurantId))
    .leftJoin(dishes, eq(dishes.id, memberDefaults.dishId))
    .where(eq(memberDefaults.memberId, member.id));
  if (defaults.length) {
    lines.push(
      `Deine Standards: ${defaults.map((entry) => `${entry.restaurant}: ${entry.dish ?? 'nix'}`).join(', ')}.`
    );
  }

  // The menus: the Friday's restaurant, while the vote runs the one they vote for, and up to
  // two restaurants the message names; get_menu has the others.
  const menus: { id: number; name: string; dishes: Dish[]; label: string }[] = [];
  if (!flat && view.restaurant) {
    menus.push({
      id: view.restaurant.id,
      name: view.restaurant.name,
      dishes: view.dishes,
      label: voting ? 'aktuell, bleibt ohne Stimmen' : 'das Restaurant dieses Freitags',
    });
  }
  const wanted = [
    ...(voting && myVote ? options.filter((option) => option.id === myVote) : []),
    ...options.filter((option) => mentions(text, option.name)).slice(0, MENTIONED_MENUS),
  ];
  for (const option of wanted) {
    if (menus.some((entry) => entry.id === option.id)) continue;
    menus.push({
      id: option.id,
      name: option.name,
      dishes: await listDishes(db, option.id),
      label: voting
        ? 'auf dem Wahlzettel; bestellen heißt vorbestellen und dafür stimmen'
        : 'nur zum Anschauen',
    });
  }
  for (const entry of menus) {
    lines.push(
      `Karte ${entry.name} (${entry.label}):`,
      ...(entry.dishes.length ? menuLines(entry.dishes) : ['keine Gerichte eingetragen'])
    );
  }
  if (!open) lines.push('Bestellen und Abstimmen sind für diesen Freitag vorbei.');
  return {
    facts: lines.join('\n'),
    restaurantIds: new Set(
      settles && open && !flat && !view.settled ? options.map((option) => option.id) : []
    ),
  };
}

const restaurantInput = z.object({ restaurant_id: z.number().int() });

/**
 * The research tools for one member (`RESEARCH_TOOLS`): they only read, always answer for
 * `member`, whatever Claude passes in, and show only what that member may see on the
 * page: no phone numbers, addresses, keys, links or other people's money.
 */
export function assistantResearch(db: Db, member: Member, now: Date): Research {
  const thisWeek = currentFriday(now);
  return async (tool, input) => {
    switch (tool) {
      case 'list_restaurants': {
        const friday = await loadFriday(db, thisWeek, now);
        const options = await restaurantsForHost(db, friday.host?.id ?? null);
        const rows = await db.select().from(restaurants).where(eq(restaurants.archived, false));
        return rows
          .map((row) => {
            const option = options.find((entry) => entry.id === row.id);
            const reach = !option
              ? 'liefert nicht zum Gastgeber dieser Woche'
              : option.delivers
                ? `liefert${row.pickup ? ', Abholen geht auch' : ''}`
                : 'nur abholen';
            return `${row.id} · ${row.name}${row.cuisine ? ` (${row.cuisine})` : ''} · Mindestbestellwert ${formatEuro(row.minOrderCents)} · Lieferung ${formatEuro(row.deliveryFeeCents)}${row.freeDeliveryFromCents !== null ? ` (ab ${formatEuro(row.freeDeliveryFromCents)} gratis)` : ''} · Servicegebühr ${formatEuro(row.serviceFeeCents)} · Trinkgeld ${formatEuro(row.tipCents)} · ${reach} · ${option?.dishCount ?? '?'} Gerichte${row.notes ? ` · ${row.notes}` : ''}`;
          })
          .join('\n');
      }

      case 'get_menu': {
        const parsed = restaurantInput.safeParse(input);
        if (!parsed.success) return 'Bitte eine Restaurantnummer angeben.';
        const [row] = await db
          .select()
          .from(restaurants)
          .where(
            and(eq(restaurants.id, parsed.data.restaurant_id), eq(restaurants.archived, false))
          );
        if (!row) return 'Das Restaurant gibt es nicht.';
        const menu = await listDishes(db, row.id);
        return [
          `Karte ${row.name}:`,
          ...(menu.length
            ? menuLines(menu).map((line, index) =>
                menu[index]!.description ? `${line} – ${menu[index]!.description}` : line
              )
            : ['keine Gerichte eingetragen']),
        ].join('\n');
      }

      case 'my_order_history': {
        const parsed = z.object({ fridays: z.number().int() }).safeParse(input);
        const fridays = Math.min(Math.max(parsed.success ? parsed.data.fridays : 12, 1), 52);
        const rows = await db
          .select({
            date: orderItems.fridayDate,
            name: orderItems.name,
            options: orderItems.options,
            quantity: orderItems.quantity,
            cents: orderItems.unitPriceCents,
            restaurant: restaurants.name,
          })
          .from(orderItems)
          .innerJoin(restaurants, eq(restaurants.id, orderItems.restaurantId))
          .where(eq(orderItems.memberId, member.id))
          .orderBy(desc(orderItems.fridayDate))
          .limit(400);
        const days = [...Map.groupBy(rows, (row) => row.date)].slice(0, fridays);
        if (!days.length) return 'Noch nie etwas bestellt.';
        return days
          .map(
            ([day, items]) =>
              `${formatDayShort(day)} ${items[0]!.restaurant}: ${items
                .map(
                  (item) =>
                    `${item.quantity > 1 ? `${item.quantity}× ` : ''}${item.name}${item.options.length ? ` (${item.options.map((option) => option.choiceName).join(', ')})` : ''} ${formatEuro(item.cents)}`
                )
                .join(', ')}`
          )
          .join('\n');
      }

      case 'get_friday': {
        const parsed = z.object({ date: z.string() }).safeParse(input);
        const date = parsed.success ? parsed.data.date : '';
        if (!isFridayIso(date)) return 'Das ist kein Freitag (YYYY-MM-DD).';
        if (date > addWeeks(thisWeek, 8)) return 'So weit voraus steht noch nichts fest.';
        // An earlier Friday nobody touched has nothing to tell, and loading it would lock it.
        if (date < thisWeek && !(await getFridayRow(db, date))) {
          return 'Zu dem Freitag gibt es nichts.';
        }
        const view = await loadFriday(db, date, now);
        const names = (ids: number[]) =>
          ids
            .map((id) => view.participants.find((entry) => entry.member.id === id)?.member.name)
            .filter(Boolean)
            .join(', ');
        const me = view.participants.find((entry) => entry.member.id === member.id);
        return [
          `Freitag ${formatDayShort(date)}${view.cancelled ? ': fällt aus' : ''}, Gastgeber: ${view.host?.name ?? 'keiner'}.`,
          view.mode === 'flat'
            ? `Pauschale: ${view.flatTitle ?? 'Pauschale'}, ${formatEuro(view.flatPriceCents ?? 0)} pro Person.`
            : `Restaurant: ${view.restaurant?.name ?? 'offen'}.`,
          ...(view.votes.length
            ? [
                `Stimmen: ${[...Map.groupBy(view.votes, (vote) => vote.restaurantId)]
                  .map(([id, votes]) => {
                    const name =
                      id === view.restaurant?.id
                        ? view.restaurant.name
                        : (view.ahead.find((entry) => entry.restaurant.id === id)?.restaurant
                            .name ?? `Restaurant ${id}`);
                    return `${name} ${votes.length} (${names(votes.map((vote) => vote.memberId))})`;
                  })
                  .join('; ')}.`,
              ]
            : []),
          ...view.participants
            .filter((entry) => entry.attendance.status !== 'out')
            .map(
              (entry) =>
                `${entry.member.name}: ${
                  entry.attendance.status === 'nofood'
                    ? 'ohne Essen'
                    : entry.items.map((item) => item.name).join(', ') || 'nichts bestellt'
                }`
            ),
          `Raus: ${names(view.participants.filter((entry) => entry.attendance.status === 'out').map((entry) => entry.member.id)) || 'keiner'}.`,
          ...(me && me.money.dueCents > 0
            ? [
                `Dein Betrag: ${formatEuro(me.money.dueCents)}, bezahlt ${formatEuro(me.money.paidCents)}, offen ${formatEuro(me.money.openCents)}.`,
              ]
            : []),
        ].join('\n');
      }

      case 'popular_dishes': {
        const parsed = restaurantInput.safeParse(input);
        if (!parsed.success) return 'Bitte eine Restaurantnummer angeben.';
        const rows = await db
          .select({ name: orderItems.name, times: count() })
          .from(orderItems)
          .where(eq(orderItems.restaurantId, parsed.data.restaurant_id))
          .groupBy(orderItems.name)
          .orderBy(desc(count()))
          .limit(15);
        return rows.length
          ? rows.map((row) => `${row.name}: ${row.times}×`).join('\n')
          : 'Dort hat die Gruppe noch nie bestellt.';
      }

      case 'upcoming_fridays': {
        const entries = await loadCalendar(db, thisWeek, 8, now);
        return entries
          .map(
            (entry) =>
              `${formatDayShort(entry.date)} (${entry.date}): ${
                entry.cancelled
                  ? `fällt aus${entry.cancelReason ? ` (${entry.cancelReason})` : ''}`
                  : [
                      entry.host
                        ? `bei ${entry.host.name}${entry.hostAbsent ? ' (ist weg, jemand muss übernehmen)' : ''}`
                        : 'kein Gastgeber, jemand muss übernehmen',
                      entry.mode === 'flat'
                        ? `${entry.flatTitle ?? 'Pauschale'} ${formatEuro(entry.flatPriceCents ?? 0)} pro Person`
                        : (entry.restaurant?.name ?? 'Restaurant offen'),
                      ...(entry.voting ? ['Restaurantwahl läuft'] : []),
                      ...(entry.absentMemberIds.includes(member.id) ? ['du bist weg'] : []),
                    ].join(', ')
              }`
          )
          .join('\n');
      }

      case 'my_balances': {
        const view = await loadFriday(db, thisWeek, now);
        const me = view.participants.find((entry) => entry.member.id === member.id);
        const earlier = (await openBalancesFor(db, member.id, thisWeek, now)).filter(
          (balance) => balance.member.id === member.id
        );
        const lines = [
          ...(me && me.money.openCents !== 0
            ? [
                `Diese Woche: ${me.money.openCents > 0 ? 'offen' : 'bekommst du'} ${formatEuro(Math.abs(me.money.openCents))}${paymentOpen(view, now) ? '' : ' (bis jetzt, bezahlt wird nach der Freigabe)'}.`,
              ]
            : []),
          ...earlier.map(
            (balance) =>
              `${formatDayShort(balance.fridayDate)} ${balance.title}: ${balance.debt.openCents > 0 ? 'offen' : 'bekommst du'} ${formatEuro(Math.abs(balance.debt.openCents))} ${balance.debt.openCents > 0 ? 'an' : 'von'} ${balance.payee?.name ?? 'den Gastgeber'}.`
          ),
        ];
        return lines.join('\n') || 'Nichts offen.';
      }

      default:
        return 'Das Werkzeug gibt es nicht.';
    }
  };
}
