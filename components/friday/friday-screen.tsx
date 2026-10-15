import {
  BookOpen,
  CalendarDays,
  Check,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Coins,
  Crown,
  ExternalLink,
  Flame,
  House,
  Sparkles,
  Store,
  TriangleAlert,
  Users,
  UtensilsCrossed,
  Vote,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { AddGuestForm } from '@/components/friday/add-guest-form';
import { AnswerControl } from '@/components/friday/answer-control';
import { CostsSection } from '@/components/friday/costs-section';
import { DeadlinePill } from '@/components/friday/deadline-pill';
import type { OrderTarget } from '@/components/friday/dish-dialog';
import { HostSection } from '@/components/friday/host-section';
import { HostPicker } from '@/components/friday/host-tools';
import { MenuChoice, type MenuOption } from '@/components/friday/menu-choice';
import { MenuPreview } from '@/components/friday/menu-preview';
import { MyMoney } from '@/components/friday/my-money';
import { OrderBar } from '@/components/friday/order-bar';
import { OrderedItems, type OrderGroup } from '@/components/friday/ordered-items';
import { ParticipantCard } from '@/components/friday/participant-card';
import { PayBox } from '@/components/friday/pay-box';
import { RestaurantVote } from '@/components/friday/restaurant-vote';
import { TakeOverButton } from '@/components/friday/take-over-button';
import { TimeLine } from '@/components/friday/time-line';
import { VoteBanner } from '@/components/friday/vote-banner';
import { AttendancePills } from '@/components/common/attendance-pills';
import { attendanceSummary } from '@/lib/attendance';
import { ChapterHeading } from '@/components/common/chapter-heading';
import { PageHero } from '@/components/layout/page-hero';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Notice } from '@/components/ui/notice';
import { addWeeks, deliveryTime, isPastDeadline, type IsoDate } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import type { Member } from '@/lib/db/schema';
import { formatDayShort, formatEuro, formatTime, formatWeekdayTime } from '@/lib/format';
import { buildOrderSheet } from '@/lib/order-sheet';
import { debtLines, feeLines, toPayee } from '@/lib/balance';
import { unitPriceCents } from '@/lib/menu/options';
import { canEditOrderOf, canManageFriday, canSetHost, canTakeOver } from '@/lib/permissions';
import {
  loadFriday,
  openBalancesFor,
  paymentOpen,
  projectVoteResult,
  type Participant,
} from '@/lib/services/fridays';
import { getDefaultHost, listGuests, listMembers } from '@/lib/services/members';
import { getDefault, membersWithDefault } from '@/lib/services/orders';
import { getRestaurant, listDishes, restaurantsForHost } from '@/lib/services/restaurants';
import { upcomingMessages } from '@/lib/services/scheduler';
import { tally, voteClosesAt, voteLetter, voteWinner, votingAt } from '@/lib/vote';
import { cn } from '@/lib/utils';

/** Answer, pick, pay: where the viewer stands this Friday, as ticks. */
function Steps({ steps }: { steps: { label: string; done: boolean }[] }) {
  return (
    <ol className="flex max-w-md items-center gap-1.5 text-xs font-semibold">
      {steps.map((step, index) => (
        <li key={step.label} className={cn('flex items-center gap-1.5', index > 0 && 'flex-1')}>
          {index > 0 && <span className="bg-border h-px min-w-2 flex-1" aria-hidden />}
          <span
            className={cn(
              'flex size-6 items-center justify-center rounded-full border text-[11px] tabular-nums',
              step.done
                ? 'border-success/50 bg-badge-success text-white'
                : 'border-border text-muted-foreground'
            )}
          >
            {step.done ? <Check className="size-3.5" /> : index + 1}
          </span>
          <span
            className={cn(
              'whitespace-nowrap',
              step.done ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export async function FridayScreen({
  db,
  date,
  viewer,
  now,
  isCurrent,
}: {
  db: Db;
  date: IsoDate;
  viewer: Member;
  now: Date;
  isCurrent: boolean;
}) {
  const view = await loadFriday(db, date, now);
  const hostId = view.host?.id ?? null;
  const manage = canManageFriday(viewer, hostId);
  // The „Gastgeber“ role swaps the host without running the Friday.
  const swapHostOnly = !manage && canSetHost(viewer, hostId);
  const closed = view.locked || isPastDeadline(date, now);
  const payable = paymentOpen(view, now);
  const lockState = { locked: closed, settled: view.settled };
  const flat = view.mode === 'flat';
  const me = view.participants.find((participant) => participant.member.id === viewer.id);
  const myDefault = view.restaurant ? await getDefault(db, viewer.id, view.restaurant.id) : null;
  const otherBalances = isCurrent ? await openBalancesFor(db, viewer.id, date, now) : [];
  // One box per earlier Friday and person, even when the food and the drinks go to two people.
  const balanceGroups = [
    ...Map.groupBy(
      otherBalances,
      (balance) => `${balance.fridayDate}-${balance.member.id}`
    ).values(),
  ];
  const voting = votingAt(view, now);
  const canBringGuests = !view.cancelled && (!closed || manage);
  const [restaurants, members, defaultHost, messages, guests] = await Promise.all([
    manage || voting ? restaurantsForHost(db, hostId) : [],
    manage || swapHostOnly ? listMembers(db) : [],
    manage || swapHostOnly ? getDefaultHost(db) : null,
    manage ? upcomingMessages(db, view, now) : [],
    canBringGuests ? listGuests(db) : [],
  ]);
  const knownGuests = guests.filter(
    (guest) => !view.participants.some((entry) => entry.member.id === guest.id)
  );
  // A guest outside the Stammtruppe is on no Friday until they say yes or someone adds them.
  const canJoin = !me && !view.cancelled && !closed && viewer.kind === 'member' && !viewer.core;
  const hostOptions = members
    .filter((member) => member.active && member.core)
    .map(({ id, name }) => ({ id, name }));

  const takenBy: Record<number, string[]> = {};
  for (const participant of view.participants) {
    const label = participant.member.id === viewer.id ? 'Du' : participant.member.name;
    const ahead = view.preorders.filter((item) => item.memberId === participant.member.id);
    for (const item of [...participant.items, ...ahead]) {
      if (item.dishId === null) continue;
      const names = (takenBy[item.dishId] ??= []);
      if (!names.includes(label)) names.push(label);
    }
  }

  const editable = (participant: Participant) =>
    canEditOrderOf(
      viewer,
      { id: participant.member.id, addedById: participant.addedById },
      hostId,
      lockState
    );
  const targets: OrderTarget[] = view.participants
    .filter(
      (participant) =>
        participant.member.id === viewer.id ||
        (editable(participant) &&
          (participant.member.kind === 'guest' ||
            !participant.member.core ||
            (manage && participant.attendance.status !== 'out')))
    )
    .map((participant) => ({
      id: participant.member.id,
      name: participant.member.name,
      isSelf: participant.member.id === viewer.id,
    }))
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf));
  const canOrder =
    !flat &&
    Boolean(view.restaurant) &&
    !view.cancelled &&
    !view.settled &&
    targets.length > 0 &&
    (!closed || manage);

  const myVote = view.votes.find((vote) => vote.memberId === viewer.id)?.restaurantId ?? null;
  // While the vote runs, the viewer can also order ahead from the restaurant they voted for.
  const canOrderAhead = voting && Boolean(me) && !closed && editable(me!);
  const votedFor =
    canOrderAhead && myVote !== view.restaurant?.id
      ? (restaurants.find((option) => option.id === myVote) ?? null)
      : null;
  const [aheadDishes, aheadDefault] = votedFor
    ? await Promise.all([listDishes(db, votedFor.id), getDefault(db, viewer.id, votedFor.id)])
    : [[], null];
  const myPreorders = voting ? view.preorders.filter((item) => item.memberId === viewer.id) : [];
  const restaurantName = (id: number) =>
    id === view.restaurant?.id
      ? view.restaurant.name
      : (restaurants.find((option) => option.id === id)?.name ?? 'anderes Restaurant');
  /** Someone's orders, by restaurant once they also ordered ahead during the vote. */
  const ordersOf = (participant: Participant): OrderGroup[] => {
    const ahead = voting
      ? view.preorders.filter((item) => item.memberId === participant.member.id)
      : [];
    return [
      ...(view.restaurant && participant.items.length > 0
        ? [
            {
              restaurantId: view.restaurant.id,
              name: view.restaurant.name,
              ahead: false,
              items: participant.items,
            },
          ]
        : []),
      ...[...Map.groupBy(ahead, (item) => item.restaurantId)].map(([restaurantId, items]) => ({
        restaurantId,
        name: restaurantName(restaurantId),
        ahead: true,
        items,
      })),
    ];
  };
  /**
   * Roughly what someone pays if a restaurant they ordered ahead from wins: their dishes
   * there, an equal part of its fees and their drinks.
   */
  const aheadAmounts = (participant: Participant) =>
    ordersOf(participant)
      .filter((group) => group.ahead)
      .map((group) => {
        const estimate = view.ahead.find((entry) => entry.restaurant.id === group.restaurantId);
        return {
          name: group.name,
          cents:
            group.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0) +
            (estimate && estimate.eaters > 0
              ? Math.round(estimate.estimate.sharedCents / estimate.eaters)
              : 0) +
            (participant.member.id === hostId ? 0 : participant.money.drinksCents),
        };
      });
  const self: OrderTarget = { id: viewer.id, name: viewer.name, isSelf: true };
  const menus: MenuOption[] = [
    ...(me && view.restaurant && canOrder
      ? [
          {
            restaurantId: view.restaurant.id,
            name: view.restaurant.name,
            dishes: view.dishes,
            targets,
            defaultDishId: myDefault?.dish?.id ?? null,
            ahead: false,
          },
        ]
      : []),
    ...(votedFor
      ? [
          {
            restaurantId: votedFor.id,
            name: votedFor.name,
            dishes: aheadDishes,
            targets: [self],
            defaultDishId: aheadDefault?.dish?.id ?? null,
            ahead: true,
            hint: `Zählt, wenn ${votedFor.name} die Wahl gewinnt.`,
          },
        ]
      : []),
  ];

  const nameOf = (id: number) =>
    view.participants.find((p) => p.member.id === id)?.member.name ?? '?';
  const visibleParticipants = view.participants.filter(
    (participant) =>
      (participant.member.kind === 'member' && participant.member.core) ||
      participant.attendance.status !== 'out'
  );
  const attendancePeople = visibleParticipants.map((participant) => ({
    id: participant.member.id,
    name: participant.member.name,
    status: participant.attendance.status,
    // The host of a flat-price evening is there without saying so.
    answered:
      participant.attendance.reason === 'answered' || (flat && participant.member.id === hostId),
    waiting: participant.attendance.reason === 'silent' && participant.attendance.status === 'out',
  }));
  // While the vote runs, the host's order list is the one the restaurant ahead would get.
  const leaderId =
    voting && restaurants.length > 1
      ? voteWinner(
          view.votes.filter((vote) =>
            restaurants.some((option) => option.id === vote.restaurantId)
          ),
          view.restaurant?.id ?? null
        )
      : (view.restaurant?.id ?? null);
  const leader =
    leaderId === null || leaderId === view.restaurant?.id
      ? null
      : (view.ahead.find((entry) => entry.restaurant.id === leaderId)?.restaurant ??
        (await getRestaurant(db, leaderId)));
  const outcome = leader ? projectVoteResult(view, leader) : view;
  const leaderDefaults = leader ? await membersWithDefault(db, leader.id) : null;
  const sheet = buildOrderSheet(
    outcome.participants.flatMap((participant) => participant.items),
    nameOf
  );
  const hungry = closed
    ? []
    : outcome.participants.filter(
        (entry) =>
          entry.attendance.status === 'in' &&
          entry.items.length === 0 &&
          !(leaderDefaults ? leaderDefaults.has(entry.member.id) : entry.projectedDefault) &&
          entry.member.id !== hostId
      );
  const amHost = viewer.id === hostId;
  const mayTakeOver = canTakeOver(viewer, {
    hostId,
    hostAbsent: view.hostAbsent,
    viewerAbsent: me?.attendance.reason === 'absent',
    locked: closed,
    cancelled: view.cancelled,
  });
  const title = view.cancelled
    ? 'Fällt aus'
    : flat
      ? (view.flatTitle ?? 'Pauschale')
      : (view.restaurant?.name ?? 'Was essen wir?');

  const silentHint = !me
    ? ''
    : flat
      ? amHost
        ? 'Als Gastgeber bist du sowieso dabei.'
        : `Für ${view.flatTitle ?? 'diesen Abend'} brauchen wir deine Zusage, sonst planen wir dich nicht ein.`
      : myDefault && !myDefault.dish
        ? 'Ohne Antwort kommst du ohne Essen – dein Standard hier ist „nix“.'
        : myDefault?.dish
          ? `Ohne Antwort zählst du als dabei und bekommst um ${formatTime(view.deadline)} dein Standardgericht (${myDefault.dish.name}).`
          : view.restaurant
            ? 'Ohne Antwort zählst du als dabei, hast hier aber kein Standardgericht – ohne Auswahl gibt es nichts.'
            : 'Ohne Antwort zählst du als dabei.';
  const answerHint = !me
    ? ''
    : me.attendance.reason === 'silent'
      ? silentHint
      : me.attendance.reason === 'absent'
        ? 'Du bist für diesen Tag abwesend eingetragen.'
        : closed
          ? `${flat ? 'Anmeldeschluss' : 'Bestellschluss'} ist vorbei. Änderungen nur noch über den Gastgeber.`
          : `Ändern geht bis ${formatTime(view.deadline)} Uhr.`;
  // The host collects rather than pays, so their steps end before „Zahlen“.
  const payDone = me
    ? me.money.openCents <= 0 && (me.money.dueCents > 0 || me.attendance.status === 'out')
    : false;

  // Voting stays open for later Fridays too, but only this week's needs the reminders that
  // the restaurant is not settled yet.
  const voteRuns = voting && restaurants.length > 1 && isCurrent;
  const showVote = voting && restaurants.length > 1 && Boolean(me);
  // A guest who has not said yes yet sees the ballot and the menu, to decide whether to come.
  const ballotShown = showVote || (voting && restaurants.length > 1 && canJoin);
  // Where the vote stands, for the banner at the top: who leads, or what a draw leaves.
  const ranked = tally(restaurants, view.votes);
  const leadVotes = ranked[0]?.voterIds.length ?? 0;
  const otherwise = view.restaurant
    ? `dann bleibt's bei ${view.restaurant.name}`
    : 'dann sucht der Gastgeber aus';
  const standing =
    leadVotes === 0
      ? `Noch keine Stimme – ${otherwise}`
      : ranked[1]?.voterIds.length === leadVotes
        ? `Gleichstand – ${otherwise}`
        : `Vorne: ${ranked[0]!.option.name} mit ${leadVotes} ${leadVotes === 1 ? 'Stimme' : 'Stimmen'}`;
  const ballot = restaurants.map((option, index) => ({
    ...option,
    letter: voteLetter(index),
    current: option.id === view.restaurant?.id,
    voters: view.votes
      .filter((vote) => vote.restaurantId === option.id)
      .map((vote) => ({ id: vote.memberId, name: nameOf(vote.memberId) })),
    preordered: myPreorders
      .filter((item) => item.restaurantId === option.id)
      .map((item) => `${item.quantity > 1 ? `${item.quantity}× ` : ''}${item.name}`),
  }));
  // The host's picker keeps the current restaurant even if it no longer serves this host.
  const pickable =
    view.restaurant && !restaurants.some((option) => option.id === view.restaurant!.id)
      ? [{ id: view.restaurant.id, name: view.restaurant.name, delivers: true }, ...restaurants]
      : restaurants;

  const myAhead = me ? aheadAmounts(me) : [];

  // The order and amount at the bottom of a phone, for whoever eats or pays this Friday.
  const orderBar =
    me &&
    !view.cancelled &&
    me.attendance.status !== 'out' &&
    (!view.settled || me.money.openCents > 0)
      ? {
          summary: flat
            ? (view.flatTitle ?? 'Pauschale')
            : me.attendance.status === 'nofood'
              ? 'Ohne Essen'
              : me.items.length > 0
                ? me.items.map((item) => item.name).join(', ')
                : me.projectedDefault
                  ? `Standard: ${me.projectedDefault.name}`
                  : myPreorders.length > 0
                    ? `Vorbestellt: ${myPreorders.map((item) => item.name).join(', ')}`
                    : 'Noch nichts ausgesucht',
          ...(me.items.length === 0 && !me.projectedDefault && myAhead[0]
            ? // With nothing from the current restaurant, what they ordered ahead says more.
              { amountCents: myAhead[0].cents, amountLabel: `falls ${myAhead[0].name}` }
            : {
                // The host pays the restaurant and collects, so their own share is what counts.
                amountCents: amHost ? (me.share?.totalCents ?? 0) : Math.abs(me.money.openCents),
                amountLabel: amHost
                  ? 'dein Anteil'
                  : !payable
                    ? 'bis jetzt'
                    : me.money.openCents > 0
                      ? 'offen'
                      : me.money.openCents < 0
                        ? 'bekommst du'
                        : 'bezahlt',
              }),
        }
      : null;

  // The viewer's outcome if the restaurant they vote for wins: what they ordered ahead there,
  // or else their default there, which a vote for it brings along.
  const aheadBoxes = me
    ? [
        ...ordersOf(me)
          .filter((group) => group.ahead)
          .map((group) => ({
            restaurantId: group.restaurantId,
            name: group.name,
            usual: false,
            dishes: group.items.map((item) => ({
              label: `${item.quantity > 1 ? `${item.quantity}× ` : ''}${item.name}`,
              cents: item.unitPriceCents * item.quantity,
            })),
          })),
        ...(votedFor &&
        aheadDefault?.dish &&
        !aheadDefault.dish.archived &&
        me.attendance.status === 'in' &&
        !myPreorders.some((item) => item.restaurantId === votedFor.id)
          ? [
              {
                restaurantId: votedFor.id,
                name: votedFor.name,
                usual: true,
                dishes: [
                  {
                    label: `${aheadDefault.dish.name} (Standard)`,
                    cents: unitPriceCents(aheadDefault.dish.priceCents, aheadDefault.entry.options),
                  },
                ],
              },
            ]
          : []),
      ]
    : [];

  const orderAside = !view.cancelled && Boolean(me);

  // The chapters are numbered in reading order. „Deine Bestellung“ goes without a number:
  // on a phone it follows the menu, on a desktop it rides along beside everything.
  let chapter = 0;

  return (
    <>
      <PageHero
        icon={flat ? Flame : CalendarDays}
        kicker={
          <span className="whitespace-nowrap">
            {isCurrent ? 'Diese Woche' : 'Freitag'} · {formatDayShort(date)}
          </span>
        }
        aside={
          <>
            <Link
              href={`/freitag/${addWeeks(date, -1)}`}
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
              aria-label="Freitag davor"
            >
              <ChevronLeft />
            </Link>
            <Link
              href={`/freitag/${addWeeks(date, 1)}`}
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
              aria-label="Nächster Freitag"
            >
              <ChevronRight />
            </Link>
          </>
        }
        title={
          voteRuns && view.restaurant ? (
            <>
              {title}{' '}
              {/* Only what it stays at if nobody votes: the vote decides on Thursday night. */}
              <span className="text-warning inline-flex items-center gap-1 align-middle text-sm font-semibold tracking-normal whitespace-nowrap">
                <Crown className="size-4" /> bisher
              </span>
            </>
          ) : (
            title
          )
        }
      >
        <div className="hero-item mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {manage && !view.cancelled && !view.settled && (
            <a
              href="#chefsache"
              className={buttonVariants({
                variant: 'outline',
                size: 'sm',
                className: 'order-last',
              })}
            >
              <Store /> {flat ? 'Restaurant oder Pauschale' : 'Restaurant wählen'}
            </a>
          )}
          {view.host && !view.cancelled && (
            <span className="inline-flex items-center gap-2">
              <Avatar name={view.host.name} id={view.host.id} className="size-6 text-[10px]" />
              <span>
                bei <strong>{view.host.name}</strong>
              </span>
              {view.hostAbsent && (
                <Badge variant="softWarning">
                  <TriangleAlert /> abwesend eingetragen
                </Badge>
              )}
            </span>
          )}
          {!view.cancelled && flat && view.flatPriceCents && (
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Flame className="text-primary size-3.5" /> {formatEuro(view.flatPriceCents)} pro
              Person
            </span>
          )}
        </div>
        {view.hostAbsent && view.host && !view.cancelled && !view.settled && (
          <Notice className="hero-item mt-4 flex items-start gap-2 text-sm">
            <TriangleAlert className="text-warning mt-0.5" />
            <span className="min-w-0 flex-1 space-y-2">
              <strong className="text-warning block">
                {amHost ? 'Du bist' : `${view.host.name} ist`} an dem Tag weg – wer macht den
                Gastgeber?
              </strong>
              {mayTakeOver && (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <TakeOverButton date={date} />
                  <span className="text-muted-foreground text-xs">
                    Dann bestellst du und das Geld geht an dich.
                  </span>
                </span>
              )}
              {manage || swapHostOnly ? (
                <a
                  href={manage ? '#chefsache' : '#vertretung'}
                  className="text-primary block font-semibold hover:underline"
                >
                  {mayTakeOver ? 'Oder jemand anderen eintragen' : 'Vertretung eintragen'}
                </a>
              ) : (
                !mayTakeOver && (
                  <span className="text-muted-foreground block">
                    Sag {amHost ? 'einem Admin' : `${view.host.name} oder einem Admin`} Bescheid,
                    wer übernimmt.
                  </span>
                )
              )}
            </span>
          </Notice>
        )}
        {!view.cancelled && me && (
          <div className="hero-item mt-5 space-y-3">
            {/* Someone who is out has nothing to tick off; the answer below says so. */}
            {me.attendance.status !== 'out' && (
              <Steps
                steps={[
                  {
                    label: 'Zusagen',
                    done: me.attendance.reason === 'answered' || (flat && amHost),
                  },
                  ...(flat
                    ? []
                    : [
                        {
                          label: 'Aussuchen',
                          done:
                            me.items.length > 0 ||
                            myPreorders.length > 0 ||
                            me.attendance.status !== 'in',
                        },
                      ]),
                  ...(amHost ? [] : [{ label: 'Zahlen', done: payDone }]),
                ]}
              />
            )}
            <AnswerControl
              date={date}
              memberId={viewer.id}
              status={me.attendance.status}
              answered={me.attendance.reason === 'answered'}
              disabled={!editable(me)}
              hasItems={me.items.length > 0}
            />
            <p className="text-muted-foreground text-xs">{answerHint}</p>
          </div>
        )}
        {canJoin && (
          <div className="hero-item mt-5 space-y-3">
            <AnswerControl
              date={date}
              memberId={viewer.id}
              status={null}
              answered={false}
              hasItems={false}
            />
            <p className="text-muted-foreground text-xs">
              Als Gast fragen wir dich nicht jede Woche. Sag einfach zu, wenn du kommst; ändern geht
              bis {formatTime(view.deadline)} Uhr.
            </p>
          </div>
        )}
        {view.note && !view.cancelled && (
          <div className="hero-item mt-4 flex items-start gap-2">
            {view.host && (
              <Avatar name={view.host.name} id={view.host.id} className="size-7 text-[10px]" />
            )}
            <p className="bg-muted/50 rounded-2xl rounded-tl-sm px-3.5 py-2 text-sm">{view.note}</p>
          </div>
        )}
        {voteRuns && (
          <div className="hero-item mt-4">
            <VoteBanner
              closesAt={voteClosesAt(date).getTime()}
              serverNow={now.getTime()}
              standing={standing}
              canVote={ballotShown}
            />
          </div>
        )}
        {!view.cancelled && (
          <div className="hero-item mt-4">
            <TimeLine
              serverNow={now.getTime()}
              moments={[
                {
                  label: flat ? 'Anmeldeschluss' : 'Bestellschluss',
                  at: view.deadline.getTime(),
                  time: formatTime(view.deadline),
                },
                ...(flat
                  ? []
                  : [
                      {
                        label: `${view.host?.name ?? 'Gastgeber'} bestellt`,
                        at: view.orderTime.getTime(),
                        time: formatTime(view.orderTime),
                      },
                      {
                        label: 'Essen gegen',
                        at: deliveryTime(date).getTime(),
                        time: formatTime(deliveryTime(date)),
                      },
                    ]),
              ]}
            />
          </div>
        )}
        {!view.cancelled && (
          <div className="hero-item mt-4 empty:hidden">
            <DeadlinePill
              deadline={view.deadline.getTime()}
              deadlineLabel={formatTime(view.deadline)}
              serverNow={now.getTime()}
              locked={closed}
              settled={view.settled}
              cancelled={view.cancelled}
              flat={flat}
            />
          </div>
        )}
        {!view.cancelled && attendancePeople.length > 0 && (
          <div className="hero-item mt-4">
            <AttendancePills people={attendancePeople} flat={flat} />
          </div>
        )}
        {view.cancelled && view.cancelReason && (
          <p className="hero-item text-muted-foreground mt-3">{view.cancelReason}</p>
        )}
        {view.cancelled && (
          <Link
            href={`/freitag/${addWeeks(date, 1)}`}
            className={buttonVariants({
              variant: 'outline',
              size: 'sm',
              className: 'hero-item mt-4',
            })}
          >
            Zum nächsten Freitag <ChevronRight />
          </Link>
        )}
        {view.cancelled && me && (
          <div className="hero-item mt-5">
            <MyMoney view={view} me={me} canEdit={false} payable={payable} />
          </div>
        )}
      </PageHero>

      {/*
        Phones: one column, the vote and the menu, then the own order, then the rest; the two
        halves of the left column dissolve (`contents`). Desktop: the halves stack on the
        left and the order rides along in a column of its own.
      */}
      <div
        className={cn(
          'mx-auto flex max-w-7xl flex-col gap-12 px-4',
          orderBar && 'max-sm:pb-20',
          orderAside &&
            'lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-x-10 lg:gap-y-12 xl:grid-cols-[minmax(0,1fr)_24rem]'
        )}
      >
        <div className="contents lg:col-start-1 lg:flex lg:min-w-0 lg:flex-col lg:gap-12 lg:empty:hidden">
          {otherBalances.length > 0 && (
            <GlassCard variant="tile" className="border-warning/40 space-y-4 p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Wallet className="text-warning size-4" /> Von früheren Freitagen
              </div>
              {balanceGroups.map((balances) => {
                const { fridayDate, member, money, title } = balances[0]!;
                const forGuest = member.id !== viewer.id;
                const owed = balances.filter((balance) => balance.debt.openCents > 0);
                const back = balances.filter((balance) => balance.debt.openCents < 0);
                return (
                  <div key={`${fridayDate}-${member.id}`} className="space-y-2">
                    <Link
                      href={`/freitag/${fridayDate}`}
                      className="hover:text-primary block text-sm"
                    >
                      {formatDayShort(fridayDate)} · {title}
                      {forGuest && ` · für ${member.name}`}
                    </Link>
                    {owed.length > 0 && (
                      <PayBox
                        date={fridayDate}
                        memberId={member.id}
                        amountCents={owed.reduce((sum, balance) => sum + balance.debt.openCents, 0)}
                        lines={debtLines(
                          money,
                          owed.map((balance) => balance.debt)
                        )}
                        payees={owed.map((balance) => toPayee(balance.payee, balance.debt))}
                        label={forGuest ? `Noch offen für ${member.name}` : 'Noch offen'}
                      />
                    )}
                    {back.map((balance) => (
                      <p key={balance.debt.what} className="text-muted-foreground text-sm">
                        {forGuest ? `${member.name} bekommt` : 'Du bekommst'}{' '}
                        {formatEuro(-balance.debt.openCents)} von{' '}
                        {balance.payee?.name ?? 'dem Gastgeber'} zurück.
                      </p>
                    ))}
                  </div>
                );
              })}
            </GlassCard>
          )}

          {ballotShown && (
            <section id="wahl" className="scroll-mt-16">
              <ChapterHeading
                number={++chapter}
                icon={Vote}
                kicker="Restaurantwahl"
                title="Wo essen wir?"
                hint={
                  view.restaurant
                    ? `Wählt keiner, bleibt's bei ${view.restaurant.name}, sonst entscheidet die Mehrheit. Abstimmen bis Donnerstag, 23:59.`
                    : 'Wählt keiner, sucht der Gastgeber aus, sonst entscheidet die Mehrheit. Abstimmen bis Donnerstag, 23:59.'
                }
              />
              <RestaurantVote
                date={date}
                options={ballot}
                myVote={myVote}
                orderAs={canOrderAhead ? self : null}
                canVote={showVote}
                closesAt={voteClosesAt(date).getTime()}
                serverNow={now.getTime()}
              />
            </section>
          )}
          {me && menus.length > 0 && (
            <section id="karte" className="scroll-mt-16">
              <ChapterHeading
                number={++chapter}
                icon={BookOpen}
                kicker="Die Karte"
                title={menus.map((menu) => menu.name).join(' oder ')}
                hint={
                  closed
                    ? 'Bestellschluss ist vorbei, als Gastgeber kannst du noch nachtragen.'
                    : menus.length > 1
                      ? 'Such bei beiden aus: Es bleibt nur, was du beim Gewinner der Wahl bestellt hast. Stehst du danach ohne Bestellung da, kriegst du Freitagmorgen per WhatsApp Bescheid.'
                      : votedFor
                        ? `Was du hier vorbestellst, zählt, wenn ${votedFor.name} die Wahl gewinnt.`
                        : voting
                          ? 'Bestellen geht schon während der Wahl. Gewinnt ein anderes Restaurant, fliegt die Bestellung raus und du kriegst Freitagmorgen per WhatsApp Bescheid.'
                          : 'Tippe auf ein Gericht, um es zu bestellen.'
                }
              />
              <MenuChoice date={date} menus={menus} takenBy={takenBy} />
            </section>
          )}

          {canJoin && !flat && view.restaurant && view.dishes.length > 0 && (
            <section id="karte" className="scroll-mt-16">
              <ChapterHeading
                number={++chapter}
                icon={BookOpen}
                kicker="Die Karte"
                title={view.restaurant.name}
                hint="Zum Reinschauen: Sag oben zu, dann kannst du hier aussuchen."
              />
              <GlassCard variant="tile" className="p-4 sm:p-5">
                <MenuPreview dishes={view.dishes} />
              </GlassCard>
            </section>
          )}
        </div>
        {orderAside && me && (
          <aside className="lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
            <section id="bestellung" className="scroll-mt-16">
              <ChapterHeading
                compact
                icon={flat ? Flame : UtensilsCrossed}
                kicker={flat ? 'Grillzeit' : 'Hunger?'}
                title={flat ? 'Dein Beitrag' : 'Deine Bestellung'}
                hint={
                  flat
                    ? `${formatEuro(view.flatPriceCents ?? 0)} pro Person, für alle gleich.`
                    : !view.restaurant && menus.length === 0
                      ? 'Der Gastgeber sucht das Restaurant noch aus.'
                      : closed
                        ? 'Bestellschluss ist vorbei.'
                        : menus.length > 0 && (
                            <>
                              {voteRuns
                                ? 'Die Wahl läuft noch, aber du kannst schon '
                                : 'Such dir '}
                              <a
                                href="#karte"
                                className="text-primary font-semibold hover:underline"
                              >
                                auf der Karte
                              </a>{' '}
                              {!voteRuns
                                ? 'was aus.'
                                : menus.length > 1
                                  ? 'aussuchen, bei beiden Restaurants.'
                                  : 'aussuchen.'}
                            </>
                          )
                }
                action={
                  view.restaurant?.lieferandoUrl ? (
                    <a
                      href={view.restaurant.lieferandoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      aria-label="Bei Lieferando ansehen"
                    >
                      <ExternalLink /> <span className="max-sm:sr-only">Lieferando</span>
                    </a>
                  ) : undefined
                }
              />
              <GlassCard variant="tile" className="mb-6 space-y-4 p-4 sm:p-5">
                {!flat && (
                  <OrderedItems
                    groups={ordersOf(me)}
                    editable={editable(me)}
                    titled={voting && restaurants.length > 1}
                  />
                )}
                {!flat &&
                  me.items.length === 0 &&
                  myDefault &&
                  !myDefault.dish &&
                  me.attendance.reason === 'silent' && (
                    <p className="text-muted-foreground text-sm">
                      Dein Standard hier ist „nix“ – ohne Bestellung kommst du ohne Essen.
                    </p>
                  )}
                {!flat &&
                  me.items.length === 0 &&
                  myDefault?.dish &&
                  me.attendance.status === 'in' && (
                    <p className="flex items-start gap-2 text-sm">
                      <Sparkles className="text-warning mt-0.5 size-4 shrink-0" />
                      <span>
                        Dein Standard hier: <strong>{myDefault.dish.name}</strong>
                        {myDefault.entry.options.length > 0 &&
                          ` (${myDefault.entry.options.map((option) => option.choiceName).join(', ')})`}
                        . Den bekommst du, wenn du bis {formatTime(view.deadline)} nichts anderes
                        aussuchst.
                      </span>
                    </p>
                  )}
                {!flat &&
                  me.items.length === 0 &&
                  !myDefault?.dish &&
                  me.attendance.status === 'in' &&
                  view.restaurant && (
                    <p className="text-muted-foreground text-sm">
                      {myPreorders.length > 0
                        ? `Bei ${view.restaurant.name} noch nichts ausgesucht.`
                        : 'Noch nichts ausgesucht.'}
                    </p>
                  )}
                {!flat &&
                  me.items.length === 0 &&
                  view.restaurant &&
                  (me.attendance.status === 'out' ||
                    (me.attendance.status === 'nofood' && me.attendance.reason !== 'silent')) && (
                    <p className="text-muted-foreground text-sm">
                      {me.attendance.reason === 'absent'
                        ? 'Du bist an dem Tag als weg eingetragen. Kommst du doch, nimm das im Kalender raus.'
                        : closed
                          ? me.attendance.status === 'out'
                            ? 'Du warst diesmal nicht dabei.'
                            : 'Du warst diesmal ohne Essen dabei.'
                          : me.attendance.status === 'out'
                            ? 'Du bist diesmal raus. Kommst du doch, such dir auf der Karte einfach was aus.'
                            : 'Du kommst ohne Essen. Kriegst du doch Hunger, such dir auf der Karte was aus.'}
                    </p>
                  )}
                {!flat && !view.restaurant && (
                  <p className="flex items-center gap-2 text-sm">
                    <Store className="text-primary size-4 shrink-0" />
                    Sobald das Restaurant feststeht, kannst du hier aussuchen.
                  </p>
                )}
                {flat && (
                  <p className="text-sm">
                    {amHost
                      ? `Du bist Gastgeber: Alle, die dabei sind, zahlen dir je ${formatEuro(view.flatPriceCents ?? 0)}.`
                      : me.attendance.status === 'in' && me.attendance.reason === 'answered'
                        ? `Du bist dabei und zahlst ${formatEuro(view.flatPriceCents ?? 0)} an ${view.host?.name ?? 'den Gastgeber'}.`
                        : `Sag oben zu, dann bist du für ${formatEuro(view.flatPriceCents ?? 0)} dabei.`}
                  </p>
                )}
                <MyMoney
                  view={view}
                  me={me}
                  canEdit={editable(me)}
                  payable={payable}
                  stays={aheadBoxes.length > 0 ? view.restaurant?.name : undefined}
                />
                {aheadBoxes.map((box) => {
                  // What it would roughly come to if that restaurant wins: their dishes there
                  // and an equal part of its fees, line by line.
                  const ahead = view.ahead.find(
                    (entry) => entry.restaurant.id === box.restaurantId
                  );
                  const lines = [
                    ...box.dishes,
                    ...(ahead && ahead.eaters > 0
                      ? feeLines(
                          Math.round(ahead.estimate.sharedCents / ahead.eaters),
                          ahead.estimate,
                          ahead.eaters
                        )
                      : []),
                    ...(!amHost && me.money.drinksCents > 0
                      ? [{ label: 'Getränke', cents: me.money.drinksCents }]
                      : []),
                  ];
                  return (
                    <PayBox
                      key={box.restaurantId}
                      date={date}
                      memberId={me.member.id}
                      amountCents={lines.reduce((sum, line) => sum + line.cents, 0)}
                      lines={lines}
                      payees={[]}
                      label={`Gewinnt ${box.name} · ungefähr`}
                      payable={false}
                      maybe
                      note={`${
                        box.usual
                          ? 'Dann bekommst du dort deinen Standard, wenn du nichts anderes aussuchst.'
                          : `Dann zählt das statt deiner Bestellung${view.restaurant ? ` bei ${view.restaurant.name}` : ''}.`
                      } Bezahlt wird erst nach dem Bestellschluss um ${formatTime(view.deadline)}.`}
                    />
                  );
                })}
              </GlassCard>
            </section>
          </aside>
        )}
        <div className="contents lg:col-start-1 lg:flex lg:min-w-0 lg:flex-col lg:gap-12">
          {!view.cancelled && (
            <section>
              <ChapterHeading
                number={++chapter}
                icon={Users}
                kicker="Die Bande"
                title="Wer ist dabei"
                hint={
                  voteRuns
                    ? `${attendanceSummary(attendancePeople, flat)} · Restaurantwahl läuft noch`
                    : attendanceSummary(attendancePeople, flat)
                }
              />
              <GlassCard variant="tile" className="px-4 py-1 sm:px-5">
                <ul className="divide-border/50 divide-y">
                  {visibleParticipants.map((participant) => (
                    <ParticipantCard
                      key={participant.member.id}
                      participant={participant}
                      view={view}
                      canEdit={editable(participant)}
                      canManage={manage}
                      payable={payable}
                      nameOf={nameOf}
                      orders={ordersOf(participant)}
                      ahead={aheadAmounts(participant)}
                      titled={voting && restaurants.length > 1}
                    />
                  ))}
                </ul>
              </GlassCard>
              {canBringGuests && (
                <div className="mt-4 max-w-2xl">
                  <AddGuestForm date={date} known={knownGuests} />
                </div>
              )}
            </section>
          )}

          {/* What everyone pays is for those taking part, not for a guest still deciding. */}
          {!view.cancelled && (view.estimate || flat) && (me || manage) && (
            <section>
              <ChapterHeading
                number={++chapter}
                icon={Coins}
                kicker="Kassensturz"
                title="Wer zahlt was"
                hint={
                  flat
                    ? 'Alle, die dabei sind, zahlen denselben Betrag.'
                    : view.settled
                      ? 'Abgerechnet mit dem echten Betrag.'
                      : voteRuns && view.restaurant
                        ? `Geschätzt für ${view.restaurant.name}, solange die Wahl läuft. Gewinnt ein anderes Restaurant, rechnen wir mit dessen Karte neu.`
                        : 'Geschätzt aus der Karte; nach der Bestellung wird mit dem echten Betrag abgerechnet.'
                }
              />
              <CostsSection
                view={view}
                payable={payable}
                aheadOnly={view.participants
                  .filter((entry) => !entry.share)
                  .flatMap((entry) =>
                    aheadAmounts(entry).map((amount) => ({
                      memberId: entry.member.id,
                      name: entry.member.name,
                      restaurant: amount.name,
                      cents: amount.cents,
                    }))
                  )}
              />
            </section>
          )}

          {manage && (
            <section id="chefsache" className="scroll-mt-16">
              <ChapterHeading
                number={++chapter}
                icon={ChefHat}
                kicker="Chefsache"
                title="Für den Gastgeber"
                hint="Nur du und die Admins sehen diesen Teil."
              />
              <HostSection
                view={view}
                closed={closed}
                sheet={sheet}
                sheetFor={leader?.name ?? null}
                hungry={hungry}
                restaurants={pickable.map(({ id, name, delivers }) => ({
                  id,
                  name: delivers ? name : `${name} (nur abholen)`,
                  isDefault: id === view.host?.defaultRestaurantId,
                }))}
                voting={voting}
                members={hostOptions}
                defaultHostName={defaultHost?.name ?? null}
                viewerIsHost={amHost}
                messages={messages.map((message) => ({
                  at: message.at.getTime(),
                  when: formatWeekdayTime(message.at),
                  kind: message.kind,
                  recipients: message.recipients,
                }))}
                serverNow={now.getTime()}
              />
            </section>
          )}

          {swapHostOnly && !view.settled && (
            <section id="vertretung" className="scroll-mt-16">
              <ChapterHeading
                number={++chapter}
                icon={House}
                kicker="Vertretung"
                title="Wer ist Gastgeber?"
                hint="Mit der Rolle Vertretungen kannst du diesen Freitag jemand anderem geben."
              />
              <GlassCard variant="tile" className="max-w-md p-5">
                <HostPicker
                  date={view.date}
                  hostId={hostId}
                  hostIsDefault={view.hostIsDefault}
                  defaultHostName={defaultHost?.name ?? null}
                  members={hostOptions}
                />
              </GlassCard>
            </section>
          )}

          {isCurrent && (
            <div className="flex justify-center">
              <Link href="/kalender" className={buttonVariants({ variant: 'outline' })}>
                <CalendarDays /> Die nächsten Freitage
              </Link>
            </div>
          )}
        </div>
      </div>
      {orderBar && <OrderBar {...orderBar} />}
    </>
  );
}
