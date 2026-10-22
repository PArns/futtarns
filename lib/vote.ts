import { berlinAt, daysBetween, todayIso, type IsoDate } from '@/lib/dates';
import type { FridayMode } from '@/lib/db/schema';
import { formatEuro, formatTime } from '@/lib/format';

/** A restaurant the group can vote for on a Friday, as seen from that Friday's host. */
export type VoteOption = {
  id: number;
  name: string;
  cuisine: string | null;
  lieferandoUrl: string | null;
  /** It delivers to the host; otherwise someone has to fetch the food. */
  delivers: boolean;
  pickup: boolean;
  minOrderCents: number;
  deliveryFeeCents: number;
  freeDeliveryFromCents: number | null;
  /** How many dishes its menu has here, so the ballot can offer to show it. */
  dishCount: number;
};

/** What ordering there costs on top: `Mindestbestellwert 15,00 € · Lieferung 2,99 € (ab 60,00 € gratis)`. */
export function deliveryTerms(
  option: Pick<
    VoteOption,
    'delivers' | 'minOrderCents' | 'deliveryFeeCents' | 'freeDeliveryFromCents'
  >
): string {
  if (!option.delivers) return 'nur abholen, ohne Liefergebühr';
  const minimum = option.minOrderCents
    ? `Mindestbestellwert ${formatEuro(option.minOrderCents)}`
    : 'kein Mindestbestellwert';
  const fee = option.deliveryFeeCents
    ? `Lieferung ${formatEuro(option.deliveryFeeCents)}${
        option.freeDeliveryFromCents !== null
          ? ` (ab ${formatEuro(option.freeDeliveryFromCents)} gratis)`
          : ''
      }`
    : 'Lieferung gratis';
  return `${minimum} · ${fee}`;
}

export type Vote = { memberId: number; restaurantId: number };

/** The vote closes on the Friday itself at this hour, three hours before the order deadline. */
export const VOTE_CLOSE_HOUR = 16;

export function voteClosesAt(date: IsoDate): Date {
  return berlinAt(date, 0, VOTE_CLOSE_HOUR);
}

/** When the vote ends, as said at `now`: `Freitag um 16:00`, `morgen um 16:00` or `heute um 16:00`. */
export function voteEndsText(date: IsoDate, now: Date): string {
  const days = daysBetween(todayIso(now), date);
  const day = days <= 0 ? 'heute' : days === 1 ? 'morgen' : 'Freitag';
  return `${day} um ${formatTime(voteClosesAt(date))}`;
}

/**
 * Whether the group can still vote at `at`: a Friday with a restaurant to order from,
 * where the host has not picked one themselves, before Friday at 16:00.
 */
export function votingAt(
  friday: {
    date: IsoDate;
    mode: FridayMode;
    cancelled: boolean;
    restaurantChosen: boolean;
    voteClosed: boolean;
  },
  at: Date
): boolean {
  return (
    friday.mode === 'delivery' &&
    !friday.cancelled &&
    !friday.restaurantChosen &&
    !friday.voteClosed &&
    at < voteClosesAt(friday.date)
  );
}

/** `A`, `B`, … for the options in their order; they stay put as restaurants are added. */
export function voteLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** The option a reply such as `b` stands for. */
export function optionForLetter<T>(options: T[], letter: string): T | null {
  const text = letter.trim().toUpperCase();
  if (text.length !== 1) return null;
  const index = text.charCodeAt(0) - 65;
  return index >= 0 && index < options.length ? options[index]! : null;
}

/** Each option with who voted for it, the most votes first, ties in the options' order. */
export function tally<T extends { id: number }>(
  options: T[],
  votes: Vote[]
): { option: T; voterIds: number[] }[] {
  return options
    .map((option) => ({
      option,
      voterIds: votes.filter((vote) => vote.restaurantId === option.id).map((v) => v.memberId),
    }))
    .sort((a, b) => b.voterIds.length - a.voterIds.length);
}

/**
 * What the vote decides: the restaurant with the most votes. Without votes, or when two
 * share the lead, it stays as it is.
 */
export function voteWinner(votes: Vote[], currentId: number | null): number | null {
  const counts = new Map<number, number>();
  for (const vote of votes) counts.set(vote.restaurantId, (counts.get(vote.restaurantId) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (!first || (second && second[1] === first[1])) return currentId;
  return first[0];
}

/**
 * Whether `more` votes still to come could change what the vote decides: by lifting another
 * option into the lead, or level with it when a tie hands it back to the current one.
 * Only votes for one of `optionIds` count, as at the count.
 */
export function couldSwing(
  votes: Vote[],
  optionIds: number[],
  currentId: number | null,
  more: number
): boolean {
  const counted = votes.filter((vote) => optionIds.includes(vote.restaurantId));
  const winner = voteWinner(counted, currentId);
  // Putting every new vote on one option is the strongest push it can get.
  return optionIds.some(
    (restaurantId) =>
      voteWinner(
        [...counted, ...Array.from({ length: more }, () => ({ memberId: 0, restaurantId }))],
        currentId
      ) !== winner
  );
}

/** Who voted for what, one line per option with votes, the most first: `Sakura Sushi 2 (Anna, Ben)`. */
export function standings(
  options: { id: number; name: string }[],
  votes: Vote[],
  nameOf: (memberId: number) => string
): string[] {
  return tally(options, votes)
    .filter((entry) => entry.voterIds.length > 0)
    .map(
      (entry) =>
        `${entry.option.name} ${entry.voterIds.length} (${entry.voterIds.map(nameOf).join(', ')})`
    );
}
