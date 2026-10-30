import { isBilled, payeeOf, payeePurpose, payeesFor, shareLines, type Money } from '@/lib/balance';
import { autoReleaseAt, berlinAt, daysBetween, todayIso, type IsoDate } from '@/lib/dates';
import { formatDayShort, formatEuro, formatTime } from '@/lib/format';
import { bold, pick } from '@/lib/messages';
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
  const place = view.hostAbsent || !view.host ? ' (wo, klären wir noch)' : `, bei ${host}`;
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
      const text = (key: string) =>
        [
          pick(
            [
              `😢 ${bold(`Freitag (${day}) fällt aus.`)}`,
              `🥲 ${bold(`Freitag (${day}) fällt leider ins Wasser.`)}`,
              `💔 ${bold(`Diesen Freitag (${day}) gibt's kein freitach.`)}`,
            ],
            key
          ),
          view.cancelReason,
          `Was als Nächstes ansteht: ${appUrl}/kalender`,
        ]
          .filter(Boolean)
          .join('\n');
      for (const entry of reachable) {
        const key = `cancel:${date}:${entry.member.id}`;
        out.push({ key, to: entry.member.phone!, text: text(key) });
      }
      if (group) out.push({ key: `cancel:${date}:group`, to: group, text: text('group') });
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
        const id = `hostaway:${date}:${key}`;
        out.push({
          key: id,
          to: hostPhone,
          text: `${pick(
            [
              `🏖️ ${bold(`Freitag (${day}) bist du weg`)}, stehst aber als Gastgeber drin. Die Bande braucht ein Dach!`,
              `🧳 ${bold(`Freitag (${day}) bist du unterwegs`)}, stehst aber als Gastgeber drin. Ohne dich essen wir auf der Straße!`,
              `🏝️ ${bold(`Freitag (${day}) bist du nicht da`)}, bist aber als Gastgeber eingetragen. Wer hütet dann die Pizza?`,
            ],
            id
          )}\nTrag ein, wer übernimmt, oder sag den Freitag ab:\n${appUrl}/kalender`,
        });
      }
    }
  }

  // Put at nobody's place: the Stammtruppe sorts out among themselves who takes it over.
  if (!view.host && view.noHost && between(now, berlinAt(date, -4, 18), view.deadline)) {
    const text = (key: string) =>
      [
        pick(
          [
            `🏠 ${bold(`Freitag (${day}) hat noch keinen Gastgeber.`)}`,
            `🏚️ ${bold(`Für Freitag (${day}) fehlt noch ein Dach.`)} Keiner ist Gastgeber.`,
            `🛋️ ${bold(`Freitag (${day}): Wessen Sofa darf's sein?`)} Noch ist keiner Gastgeber.`,
          ],
          key
        ),
        `Macht das unter euch aus: Wer kann, antwortet mit ${bold('übernehme')} oder tippt auf der Seite auf „Ich übernehme“.`,
        link,
      ].join('\n');
    for (const entry of reachable) {
      if (!entry.member.core || entry.attendance.reason === 'absent') continue;
      const key = `nohost:${date}:${entry.member.id}`;
      out.push({ key, to: entry.member.phone!, text: text(key) });
    }
    if (group) out.push({ key: `nohost:${date}:group`, to: group, text: text('group') });
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
        const id = `pick:${date}:${key}`;
        const joke = pick(
          [
            'Die Mägen werden unruhig.',
            'Die ersten knabbern schon an der Tischkante.',
            'Ohne Restaurant gibt’s nur Leitungswasser.',
          ],
          id
        );
        out.push({
          key: id,
          to: hostPhone,
          text: `🤔 ${bold(`Für Freitag (${day}) steht noch kein Restaurant fest.`)}\n${joke} Such eins aus, dann können alle bestellen:\n${link}`,
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
  // Answer and vote fit into one reply, the digit first or the letter.
  const both = `Beides in einem geht auch: ${bold(`1${voteLetter(1)}`)} heißt dabei und ${voteLetter(1)}.`;
  /** The end of a message that asks who comes: the ballot, or that their vote is in. */
  const voteLines = (id: number) =>
    !voting
      ? [link]
      : hasVoted(id)
        ? [
            `Die Restaurantwahl läuft bis ${bold(voteEndsText(date, now))}. Deine Stimme ist schon drin.`,
            link,
          ]
        : [vote, both, '', more];
  if (between(now, berlinAt(date, -2, 12), fridayMorning)) {
    const hello = `${untilFriday(date, now)} ist wieder Freitag${place}`;
    // The question who comes first, the vote after it; one link for everything else.
    for (const entry of unanswered) {
      const key = `ask:${date}:${entry.member.id}`;
      out.push({
        key,
        to: entry.member.phone!,
        text: [
          `${pick(
            [
              `🍕 ${bold(`${hello}!`)}`,
              `🥳 ${bold(`${hello}!`)}`,
              `🔔 ${bold(`Aufgepasst: ${hello}!`)}`,
            ],
            key
          )}${voting ? '' : ` Diesmal ${what}.`}`,
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
      const ends = bold(voteEndsText(date, now));
      const text = (key: string) =>
        [
          ...pick(
            [
              [
                `🗳️ ${bold('Deine Stimme kann’s noch drehen!')}`,
                `Das Wahllokal schließt ${ends}, und von dir fehlt noch die Stimme.`,
              ],
              [
                `🗳️ ${bold('Noch ist nichts entschieden!')}`,
                `Abstimmen geht bis ${ends}, und deine Stimme fehlt noch.`,
              ],
              [
                `📣 ${bold('Wahlbeteiligung ausbaufähig!')}`,
                `Die Urnen schließen ${ends}, und von dir fehlt noch die Stimme.`,
              ],
            ],
            key
          ),
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
        const key = `votenudge:${date}:${entry.member.id}`;
        out.push({ key, to: entry.member.phone!, text: text(key) });
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
      const choose = `Such dir bis ${bold(deadline)} dort was aus, sonst ${orderFallback(id)}.`;
      const asks = unanswered.some((other) => other.member.id === id);
      const key = `revote:${date}:${id}`;
      const result = `${pick(
        [
          `🗳️ ${prefix}${bold('Das Volk hat gewählt:')}`,
          `🗳️ ${prefix}${bold('Die Wahl ist durch:')}`,
          `🏆 ${prefix}${bold('Wir haben einen Sieger:')}`,
        ],
        key
      )} Heute gibt's ${bold(restaurant.name)}`;
      out.push({
        key,
        to: phone,
        text: asks
          ? `${result}${place}!\n\n${ANSWER_HINT}\n\n${rule}\n${choose}\n${link}`
          : `${result}!\n${choose}\n${link}`,
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
      const key = `${open ? 'invite-open' : 'invite'}:${date}:${id}`;
      const name = entry.member.name;
      out.push({
        key,
        to: entry.member.phone!,
        text: [
          pick(
            [
              `🎉 ${bold(`Es ist Freitag, ${name}!`)}`,
              `🥳 ${bold(`Endlich Freitag, ${name}!`)}`,
              `🍻 ${bold(`Hallo ${name}, heute ist freitach!`)}`,
            ],
            key
          ),
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
        text: `${pick(
          [
            `🎉 ${bold(`Es ist Freitag! Heute ${what}`)}`,
            `🥳 ${bold(`Endlich Freitag! Heute ${what}`)}`,
            `🍻 ${bold(`Heute ist freitach! Heute ${what}`)}`,
          ],
          `invite:${date}:group`
        )}${place}.\n${flat ? 'Anmeldeschluss' : 'Bestellschluss'}: ${bold(deadline)}\n${link}`,
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
      const key = `restaurant:${date}:${restaurant.id}:${id}`;
      out.push({
        key,
        to: entry.member.phone!,
        text: `${pick(
          [
            `📣 Für heute steht es fest: ${bold(restaurant.name)}.`,
            `📣 Entschieden: Heute gibt's ${bold(restaurant.name)}.`,
            `🎲 Die Würfel sind gefallen: ${bold(restaurant.name)}.`,
          ],
          key
        )}\nSuch dir bis ${bold(deadline)} was aus, sonst ${orderFallback(id)}.\n${link}`,
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
          const key = `order:${date}:${entry.member.id}`;
          const name = bold(restaurant.name);
          const until = bold(deadline);
          // With a default, nothing goes wrong by staying silent: it only offers a change.
          return usual
            ? pick(
                [
                  `🍽️ Heute gibt's ${name}. Sagst du nichts, bekommst du deinen Standard (${bold(usual)}). Lieber was anderes? Aussuchen geht bis ${until}:`,
                  `🍽️ Heute gibt's ${name}. Ohne Antwort kommt dein Standard (${bold(usual)}) auf den Tisch. Lust auf was anderes? Aussuchen geht bis ${until}:`,
                  `😋 Heute gibt's ${name}, dein Standard (${bold(usual)}) ist schon vorgemerkt. Doch was anderes? Aussuchen geht bis ${until}:`,
                ],
                key
              )
            : `${pick(
                [
                  `🍽️ ${bold('Dein Magen hat angerufen:')} Du hast für heute Abend noch nichts ausgesucht.`,
                  `🍽️ ${bold('Knurrt da was?')} Du hast für heute Abend noch nichts ausgesucht.`,
                  `🍽️ ${bold('Dein Teller ist noch leer:')} Du hast für heute Abend noch nichts ausgesucht.`,
                ],
                key
              )}\nBis ${until} kannst du bei ${name} aussuchen, sonst gibt’s für dich nichts.`;
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
            pick(
              [
                `⏰ ${bold('Letzte Chance!')} Bis ${bold(deadline)} kannst du noch bei ${bold(restaurant.name)} aussuchen, sonst schaust du heute Abend nur beim Essen zu.`,
                `⏰ ${bold('Letzte Chance!')} Bis ${bold(deadline)} kannst du noch bei ${bold(restaurant.name)} aussuchen, sonst bleibt dein Teller heute leer.`,
                `🚨 ${bold('Gleich ist Bestellschluss!')} Bis ${bold(deadline)} kannst du noch bei ${bold(restaurant.name)} aussuchen, sonst gibt’s für dich nur den Duft.`,
              ],
              `lastcall:${date}:${entry.member.id}`
            ),
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
  const settledText = (entry: Participant, open: number, prefix: string, key: string) => {
    const head = pick(
      [
        `🧮 ${prefix}${bold('Abgerechnet:')}`,
        `🧾 ${prefix}${bold('Die Rechnung steht:')}`,
        `🧮 ${prefix}${bold('Kassensturz:')}`,
      ],
      key
    );
    return open > 0
      ? `${head} noch ${bold(formatEuro(open))} offen.\n\n${payLines(view, entry.money)}\n\nSchon gezahlt? Hier abhaken:\n${paidLink(entry.member.id)}`
      : `${head} ${bold(formatEuro(-open))} zu viel gezahlt, ${refundFrom(entry.money)} gibt das zurück.`;
  };
  if (view.locked && tellsPay && dayOffset <= PAY_REMINDER_DAYS) {
    for (const entry of view.participants) {
      const open = entry.money.openCents;
      if ((settledSays ? Math.abs(open) : open) < NAG_THRESHOLD_CENTS) continue;
      const { phone, prefix } = billTo(entry);
      if (!phone) continue;
      const key = `due:${date}:${entry.member.id}`;
      // Settled by the time the link goes out, it tells the settled amount.
      if (settledSays) {
        out.push({ key, to: phone, text: settledText(entry, open, prefix, key) });
        continue;
      }
      const guest = entry.member.kind === 'guest' ? entry.member.name : null;
      const amount = bold(formatEuro(open));
      const yours = guest ? 'dein' : 'der';
      // What the money is for, said with a wink: a seat, a meal, or only the drinks.
      const opener = flat
        ? pick(
            [
              `🎟️ ${bold('Anmeldeschluss!')} ${guest ? `Dein Gast ${guest} ist dabei` : 'Dein Platz ist sicher'}, jetzt darf ${yours} Geldbeutel nachziehen: ${amount}.`,
              `🎟️ ${bold('Anmeldeschluss!')} ${guest ? `Dein Gast ${guest} ist eingeplant` : 'Du bist eingeplant'}, fehlt nur noch das Geld: ${amount}.`,
              `🎫 ${bold('Anmeldeschluss!')} ${guest ? `Für deinen Gast ${guest} steht ein Platz bereit` : 'Dein Platz steht bereit'}, die Kasse freut sich auf ${amount}.`,
            ],
            key
          )
        : entry.items.length === 0
          ? pick(
              [
                `🥤 ${bold('Bestellschluss!')} Ohne Essen, aber nicht ohne Durst: ${amount} für die Getränke${guest ? ` von ${guest}` : ''}.`,
                `🥤 ${bold('Bestellschluss!')} Nix gegessen, aber was getrunken: ${amount} für die Getränke${guest ? ` von ${guest}` : ''}.`,
                `🍺 ${bold('Bestellschluss!')} Die Getränkekasse ruft: ${amount} für die Getränke${guest ? ` von ${guest}` : ''}.`,
              ],
              key
            )
          : pick(
              [
                `🍽️ ${bold('Bestellschluss!')} ${guest ? `Dein Gast ${guest} hat` : 'Dein Magen hat'} bestellt, jetzt darf ${yours} Geldbeutel nachziehen: ${amount}.`,
                `🍽️ ${bold('Bestellschluss!')} ${guest ? `Das Essen von ${guest}` : 'Dein Essen'} ist bestellt, jetzt ist ${yours} Geldbeutel dran: ${amount}.`,
                `😋 ${bold('Bestellschluss!')} ${guest ? `${guest} wird satt` : 'Du wirst satt'}, und das kostet ${amount}.`,
              ],
              key
            );
      out.push({
        key,
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
      const key = `fix:${date}:${entry.member.id}:r${view.paymentRound}`;
      out.push({
        key,
        to: phone,
        text: `${pick(
          [
            `🔁 ${bold('Korrektur, der Betrag hat sich geändert.')}`,
            `🔁 ${bold('Kleine Korrektur:')} Dein Betrag hat sich geändert.`,
            `🔁 ${bold('Update vom Kassenwart:')} Der Betrag hat sich geändert.`,
          ],
          key
        )}\n${
          settledSays
            ? settledText(entry, open, prefix, key)
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
            `${pick(
              view.pickup
                ? [
                    `🛍️ ${bold('Bestellschluss!')}`,
                    `🛍️ ${bold('Ab zur Theke!')}`,
                    `🏃 ${bold('Bestellschluss, auf geht’s!')}`,
                  ]
                : [
                    `🛵 ${bold('Bestellschluss!')}`,
                    `🛵 ${bold('Ab in die Küche!')}`,
                    `📋 ${bold('Bestellschluss, die Liste steht!')}`,
                  ],
              `sheet:${date}`
            )} ${view.pickup ? `Zum Abholen bei ${restaurant}` : `Das geht an ${restaurant}`}:`,
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
      const key = `settle:${date}:${today}`;
      out.push({
        key,
        to: hostPhone,
        text: `${pick(
          [
            `🧾 ${bold(`Was hat Freitag (${day}) bei Lieferando gekostet?`)}`,
            `🧾 ${bold(`Na, wie teuer war Freitag (${day})?`)}`,
            `🧾 ${bold(`Kassensturz für Freitag (${day}):`)} Was hat Lieferando verlangt?`,
          ],
          key
        )}\nWeicht es von der Schätzung ab, trag den Betrag ein, dann bekommt eine Korrektur, wessen Betrag sich ändert. Sonst bleibt es bei der Schätzung:\n${link}`,
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
        const key = `pay:${date}:${entry.member.id}:${today}`;
        const nudge = pick(
          [
            `💸 ${prefix}${bold('Kleine Erinnerung:')}`,
            `💸 ${prefix}${bold('Pssst:')}`,
            `👛 ${prefix}${bold('Dein Geldbeutel hat was vergessen:')}`,
            `🐷 ${prefix}${bold('Das Sparschwein wartet:')}`,
          ],
          key
        );
        out.push({
          key,
          to: phone,
          text: `${nudge} Für Freitag (${day}) sind noch ${bold(formatEuro(open))} offen.\n\n${payLines(view, entry.money)}\n\nSchon gezahlt? Hier abhaken, dann hören die Erinnerungen auf:\n${paidLink(entry.member.id)}`,
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
  nohost: 'Kein Gastgeber, wer übernimmt?',
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
