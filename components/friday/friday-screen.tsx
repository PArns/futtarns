import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Flame,
  House,
  Receipt,
  ShoppingBag,
  Sparkles,
  Store,
  TriangleAlert,
  Undo2,
  Wallet,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { AddGuestForm } from '@/components/friday/add-guest-form';
import { AnswerControl } from '@/components/friday/answer-control';
import { AnswerSelect } from '@/components/friday/answer-select';
import { DeadlinePill } from '@/components/friday/deadline-pill';
import type { OrderTarget } from '@/components/friday/dish-dialog';
import { FlatForm } from '@/components/friday/flat-form';
import {
  CancelToggle,
  HostPicker,
  NoteEditor,
  RestaurantPicker,
} from '@/components/friday/host-tools';
import { ItemRow } from '@/components/friday/item-row';
import { Menu } from '@/components/friday/menu';
import { MoneyStatus } from '@/components/friday/money-status';
import { PayBox } from '@/components/friday/pay-box';
import { SettleForm } from '@/components/friday/settle-form';
import { ChapterHeading } from '@/components/common/chapter-heading';
import { CopyButton } from '@/components/common/copy-button';
import { PageHero } from '@/components/layout/page-hero';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { addWeeks, deliveryTime, isPastDeadline, type IsoDate } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import type { Member } from '@/lib/db/schema';
import { centsToInput, formatDay, formatDayShort, formatEuro, formatTime } from '@/lib/format';
import { buildOrderSheet, orderSheetText } from '@/lib/order-sheet';
import { canEditOrderOf, canManageFriday } from '@/lib/permissions';
import { loadFriday, openBalancesFor, type Participant } from '@/lib/services/fridays';
import { absencesOverlapping, getDefaultHost, listMembers } from '@/lib/services/members';
import { getDefault } from '@/lib/services/orders';
import { listRestaurants } from '@/lib/services/restaurants';
import { cn } from '@/lib/utils';

const STATUS_BADGE = {
  in: { label: 'Dabei', variant: 'softSuccess' },
  nofood: { label: 'Isst nix', variant: 'soft' },
  out: { label: 'Raus', variant: 'outline' },
} as const;

function reasonLabel(participant: Participant): string | null {
  if (participant.attendance.reason === 'silent') return 'noch keine Antwort';
  if (participant.attendance.reason === 'absent') return 'abwesend eingetragen';
  return null;
}

/** Answer, pick, pay: where the viewer stands this Friday, as three ticks. */
function Steps({ steps }: { steps: { label: string; done: boolean }[] }) {
  return (
    <ol className="flex items-center gap-2 text-xs font-semibold">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-center gap-2">
          {index > 0 && <span className="bg-border h-px w-4 sm:w-8" aria-hidden />}
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
          <span className={step.done ? 'text-foreground' : 'text-muted-foreground'}>
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
  const closed = view.locked || isPastDeadline(date, now);
  const lockState = { locked: closed, settled: view.settled };
  const flat = view.mode === 'flat';
  const me = view.participants.find((participant) => participant.member.id === viewer.id);
  const myDefault = view.restaurant ? await getDefault(db, viewer.id, view.restaurant.id) : null;
  const otherBalances = isCurrent ? await openBalancesFor(db, viewer.id, date, now) : [];
  const [restaurants, members, defaultHost] = manage
    ? await Promise.all([listRestaurants(db), listMembers(db), getDefaultHost(db)])
    : [[], [], null];
  const hostAbsent = hostId
    ? (await absencesOverlapping(db, date, date)).some((absence) => absence.memberId === hostId)
    : false;

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

  const nameOf = (id: number) =>
    view.participants.find((p) => p.member.id === id)?.member.name ?? '?';
  const count = (status: 'in' | 'nofood' | 'out') =>
    view.participants.filter((p) => p.attendance.status === status).length;
  const visibleParticipants = view.participants.filter(
    (participant) => participant.member.kind === 'member' || participant.attendance.status !== 'out'
  );
  const allItems = view.participants.flatMap((participant) => participant.items);
  const sheet = buildOrderSheet(allItems, nameOf);
  const amHost = viewer.id === hostId;
  const myOpen = me?.money.openCents ?? 0;
  const title = view.cancelled
    ? 'Fällt aus'
    : flat
      ? (view.flatTitle ?? 'Pauschale')
      : (view.restaurant?.name ?? 'Was essen wir?');
  let chapter = 0;

  return (
    <>
      <PageHero
        kicker={
          <>
            {isCurrent ? 'Diesen Freitag' : 'Freitag'} · {formatDay(date)}
          </>
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
        title={title}
      >
        <div className="hero-item mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {view.host && (
            <span className="inline-flex items-center gap-2">
              <Avatar name={view.host.name} id={view.host.id} className="size-6 text-[10px]" />
              <span>
                bei <strong>{view.host.name}</strong>
              </span>
              {hostAbsent && (
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
          {!view.cancelled && (
            <span className="text-muted-foreground inline-flex items-center gap-1.5">
              <Clock className="text-primary size-3.5" />
              Schluss {formatTime(view.deadline)}
              {!flat &&
                ` · Bestellung ${formatTime(view.orderTime)} · Essen ~${formatTime(deliveryTime(date))}`}
            </span>
          )}
        </div>

        <div className="hero-item mt-4 flex flex-wrap items-center gap-3">
          <DeadlinePill
            deadline={view.deadline.getTime()}
            deadlineLabel={formatTime(view.deadline)}
            serverNow={now.getTime()}
            locked={closed}
            settled={view.settled}
            cancelled={view.cancelled}
          />
        </div>

        {view.cancelled && view.cancelReason && (
          <p className="hero-item text-muted-foreground mt-3">{view.cancelReason}</p>
        )}
        {view.note && !view.cancelled && (
          <p className="hero-item border-primary/30 bg-primary/10 mt-4 rounded-xl border px-4 py-3 text-sm">
            {view.note}
          </p>
        )}

        {!view.cancelled && me && (
          <div className="hero-item mt-5 space-y-3">
            <Steps
              steps={[
                { label: 'Zusagen', done: me.attendance.reason === 'answered' },
                ...(flat
                  ? []
                  : [
                      {
                        label: 'Aussuchen',
                        done: me.items.length > 0 || me.attendance.status !== 'in',
                      },
                    ]),
                {
                  label: 'Zahlen',
                  done:
                    amHost ||
                    (myOpen <= 0 && (me.money.dueCents > 0 || me.attendance.status !== 'in')),
                },
              ]}
            />
            <AnswerControl
              date={date}
              memberId={viewer.id}
              status={me.attendance.status}
              disabled={!editable(me)}
              hasItems={me.items.length > 0}
            />
            <p className="text-muted-foreground text-xs">
              {me.attendance.reason === 'silent'
                ? `Du hast noch nicht geantwortet. Ohne Antwort zählst du als dabei${
                    flat
                      ? ` und zahlst ${formatEuro(view.flatPriceCents ?? 0)}.`
                      : myDefault
                        ? ` und bekommst um ${formatTime(view.deadline)} dein Standardgericht (${myDefault.dish.name}).`
                        : view.restaurant
                          ? ', hast hier aber kein Standardgericht – ohne Auswahl gibt es nichts.'
                          : '.'
                  }`
                : me.attendance.reason === 'absent'
                  ? 'Du bist für diesen Tag abwesend eingetragen.'
                  : closed
                    ? 'Schluss ist vorbei. Änderungen nur noch über den Gastgeber.'
                    : `Ändern geht bis ${formatTime(view.deadline)} Uhr.`}
            </p>
          </div>
        )}

        {!view.cancelled && me && view.host && !amHost && myOpen > 0 && (
          <div className="hero-item mt-5">
            <PayBox
              date={date}
              openCents={myOpen}
              payeeName={view.host.name}
              paypalMe={view.host.paypalMe}
            />
          </div>
        )}
        {!view.cancelled && me && view.host && !amHost && myOpen < 0 && (
          <p className="hero-item border-primary/40 bg-primary/10 mt-5 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm">
            <Undo2 className="text-primary size-4 shrink-0" />
            Du hast {formatEuro(-myOpen)} zu viel gezahlt. {view.host.name} gibt dir das zurück.
          </p>
        )}
      </PageHero>

      <div className="mx-auto max-w-5xl space-y-12 px-4">
        {otherBalances.length > 0 && (
          <GlassCard variant="tile" className="border-warning/40 space-y-3 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Wallet className="text-warning size-4" /> Von früheren Freitagen
            </div>
            {otherBalances.map((balance) => (
              <div key={balance.fridayDate}>
                <Link
                  href={`/freitag/${balance.fridayDate}`}
                  className="hover:text-primary mb-2 block text-sm"
                >
                  {formatDayShort(balance.fridayDate)} · {balance.title}
                </Link>
                {balance.money.openCents > 0 && balance.payee ? (
                  <PayBox
                    date={balance.fridayDate}
                    openCents={balance.money.openCents}
                    payeeName={balance.payee.name}
                    paypalMe={balance.payee.paypalMe}
                    label="Noch offen"
                  />
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Du bekommst {formatEuro(-balance.money.openCents)} von{' '}
                    {balance.payee?.name ?? 'dem Gastgeber'} zurück.
                  </p>
                )}
              </div>
            ))}
          </GlassCard>
        )}

        {!view.cancelled && !flat && (
          <section>
            <ChapterHeading
              number={++chapter}
              kicker="Essen"
              title="Deine Bestellung"
              hint={
                view.restaurant
                  ? closed
                    ? 'Bestellschluss ist vorbei.'
                    : 'Tippe auf ein Gericht, um es zu bestellen.'
                  : 'Der Gastgeber sucht das Restaurant noch aus.'
              }
              action={
                view.restaurant?.lieferandoUrl ? (
                  <a
                    href={view.restaurant.lieferandoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    <ExternalLink /> <span className="max-sm:sr-only">Lieferando</span>
                  </a>
                ) : undefined
              }
            />
            {me && (me.items.length > 0 || myDefault) && (
              <GlassCard variant="tile" className="mb-6 p-4 sm:p-5">
                {me.items.length > 0 ? (
                  <>
                    <ul className="divide-border/50 divide-y">
                      {me.items.map((item) => (
                        <ItemRow key={item.id} item={item} editable={editable(me)} />
                      ))}
                    </ul>
                    {me.share && (
                      <div className="border-border/60 mt-2 flex items-baseline justify-between gap-2 border-t pt-3 text-sm">
                        <span className="text-muted-foreground">
                          {view.settled
                            ? 'Dein Betrag'
                            : 'Mit deinem Anteil an Liefer- und Servicegebühr'}
                        </span>
                        <span className="text-lg font-extrabold tabular-nums">
                          {formatEuro(me.share.totalCents)}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  myDefault && (
                    <p className="flex items-center gap-2 text-sm">
                      <Sparkles className="text-warning size-4 shrink-0" />
                      <span>
                        Dein Standard hier: <strong>{myDefault.dish.name}</strong>
                        {myDefault.entry.options.length > 0 &&
                          ` (${myDefault.entry.options.map((option) => option.choiceName).join(', ')})`}
                        . Den bekommst du, wenn du bis {formatTime(view.deadline)} nichts anderes
                        wählst.
                      </span>
                    </p>
                  )
                )}
              </GlassCard>
            )}
            {view.restaurant && canOrder && (
              <Menu
                dishes={view.dishes}
                mode="order"
                date={date}
                restaurantId={view.restaurant.id}
                targets={targets}
                initialTargetId={targets[0]!.id}
                defaultDishId={myDefault?.dish.id ?? null}
              />
            )}
            {!view.restaurant && (
              <GlassCard variant="flat" className="flex items-center gap-3 p-5 text-sm">
                <Store className="text-primary size-5 shrink-0" />
                Sobald das Restaurant feststeht, kannst du hier aussuchen
                {viewer.phone ? ' – du bekommst eine WhatsApp.' : '.'}
              </GlassCard>
            )}
          </section>
        )}

        {!view.cancelled && (
          <section>
            <ChapterHeading
              number={++chapter}
              kicker="Runde"
              title="Wer ist dabei"
              hint={`${count('in')} ${flat ? 'dabei' : 'essen mit'} · ${count('nofood')} ohne Essen · ${count('out')} raus`}
            />
            <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleParticipants.map((participant) => {
                const badge = STATUS_BADGE[participant.attendance.status];
                const reason = reasonLabel(participant);
                const canEdit = editable(participant);
                const isHost = participant.member.id === hostId;
                const showMoney =
                  participant.money.dueCents !== 0 ||
                  participant.money.paidCents !== 0 ||
                  participant.money.drinksCents !== 0;
                return (
                  <GlassCard
                    key={participant.member.id}
                    variant="tile"
                    className={cn('p-4', participant.attendance.status === 'out' && 'opacity-60')}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar name={participant.member.name} id={participant.member.id} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-bold">{participant.member.name}</span>
                          {isHost && <House className="text-primary size-3.5 shrink-0" />}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {participant.member.kind === 'guest'
                            ? `Gast${participant.addedById ? ` von ${nameOf(participant.addedById)}` : ''}`
                            : (reason ??
                              (participant.hasDefault && !flat ? 'hat einen Standard' : ''))}
                        </div>
                      </div>
                      {canEdit && participant.member.id !== viewer.id ? (
                        <AnswerSelect
                          date={date}
                          memberId={participant.member.id}
                          status={participant.attendance.status}
                        />
                      ) : (
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      )}
                    </div>
                    {participant.items.length > 0 && (
                      <ul className="divide-border/50 mt-2 divide-y">
                        {participant.items.map((item) => (
                          <ItemRow
                            key={item.id}
                            item={item}
                            editable={canEdit && participant.member.id !== viewer.id}
                          />
                        ))}
                      </ul>
                    )}
                    {showMoney && (
                      <div className="border-border/60 mt-2 flex items-center justify-between gap-2 border-t pt-2 text-sm">
                        <MoneyStatus
                          date={date}
                          memberId={participant.member.id}
                          money={participant.money}
                          isHost={isHost}
                          canManage={manage}
                        />
                        {participant.share && (
                          <span className="shrink-0 font-extrabold tabular-nums">
                            {formatEuro(participant.share.totalCents)}
                          </span>
                        )}
                      </div>
                    )}
                  </GlassCard>
                );
              })}
            </div>
            {(!closed || manage) && (
              <div className="mt-4 max-w-md">
                <AddGuestForm date={date} />
              </div>
            )}
          </section>
        )}

        {!view.cancelled && (view.estimate || flat) && (
          <section>
            <ChapterHeading
              number={++chapter}
              kicker="Geld"
              title="Kosten"
              hint={
                flat
                  ? 'Alle, die dabei sind, zahlen denselben Betrag.'
                  : view.settled
                    ? 'Abgerechnet mit dem echten Betrag.'
                    : 'Geschätzt aus der Karte; nach der Bestellung wird mit dem echten Betrag abgerechnet.'
              }
            />
            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
              <GlassCard variant="tile" className="p-5">
                <dl className="space-y-2 text-sm">
                  {flat ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">
                        {view.shares.length} × {formatEuro(view.flatPriceCents ?? 0)}
                      </dt>
                      <dd className="font-bold tabular-nums">
                        {formatEuro(view.shares.length * (view.flatPriceCents ?? 0))}
                      </dd>
                    </div>
                  ) : (
                    view.estimate && (
                      <>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Gerichte</dt>
                          <dd className="tabular-nums">
                            {formatEuro(view.estimate.subtotalCents)}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Liefergebühr</dt>
                          <dd className="tabular-nums">
                            {formatEuro(view.estimate.deliveryFeeCents)}
                          </dd>
                        </div>
                        {view.estimate.serviceFeeCents > 0 && (
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">Servicegebühr</dt>
                            <dd className="tabular-nums">
                              {formatEuro(view.estimate.serviceFeeCents)}
                            </dd>
                          </div>
                        )}
                        <div className="border-border/60 flex justify-between border-t pt-2 font-bold">
                          <dt>{view.finalTotalCents !== null ? 'Geschätzt' : 'Summe'}</dt>
                          <dd className="tabular-nums">{formatEuro(view.estimate.totalCents)}</dd>
                        </div>
                        {view.finalTotalCents !== null && (
                          <div className="flex justify-between text-base font-extrabold">
                            <dt>Wirklich bezahlt</dt>
                            <dd className="tabular-nums">{formatEuro(view.finalTotalCents)}</dd>
                          </div>
                        )}
                      </>
                    )
                  )}
                  {view.drinksCents > 0 && (
                    <div className="text-muted-foreground flex justify-between pt-2">
                      <dt>Getränkekasse</dt>
                      <dd className="tabular-nums">{formatEuro(view.drinksCents)}</dd>
                    </div>
                  )}
                </dl>
                {!flat &&
                  view.estimate &&
                  view.estimate.missingForMinimumCents > 0 &&
                  view.estimate.subtotalCents > 0 && (
                    <p className="border-warning/40 bg-warning/10 text-warning mt-4 flex items-start gap-2 rounded-xl border p-3 text-xs font-semibold">
                      <TriangleAlert className="size-4 shrink-0" />
                      Es fehlen noch {formatEuro(view.estimate.missingForMinimumCents)} bis zum
                      Mindestbestellwert.
                    </p>
                  )}
              </GlassCard>
              <GlassCard variant="tile" className="p-5">
                {view.shares.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Noch ist niemand mit Essen dabei.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground text-left text-xs">
                        <th className="pb-2 font-medium">Wer</th>
                        <th className="pb-2 text-right font-medium">{flat ? 'Betrag' : 'Essen'}</th>
                        {!flat && <th className="pb-2 text-right font-medium">Anteil</th>}
                        <th className="pb-2 text-right font-medium">Offen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-border/50 divide-y">
                      {view.shares.map((entry) => {
                        const money = view.participants.find(
                          (p) => p.member.id === entry.memberId
                        )?.money;
                        return (
                          <tr key={entry.memberId}>
                            <td className="py-2 font-medium">{nameOf(entry.memberId)}</td>
                            <td className="py-2 text-right tabular-nums">
                              {formatEuro(entry.itemsCents)}
                            </td>
                            {!flat && (
                              <td className="text-muted-foreground py-2 text-right tabular-nums">
                                {entry.sharedCents >= 0 ? '+' : ''}
                                {formatEuro(entry.sharedCents)}
                              </td>
                            )}
                            <td
                              className={cn(
                                'py-2 text-right font-bold tabular-nums',
                                money && money.openCents > 0 && 'text-warning',
                                money && money.openCents < 0 && 'text-primary'
                              )}
                            >
                              {entry.memberId === hostId ? '–' : formatEuro(money?.openCents ?? 0)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </GlassCard>
            </div>
          </section>
        )}

        {manage && (
          <section>
            <ChapterHeading
              number={++chapter}
              icon={Wrench}
              kicker="Gastgeber"
              title="Für den Gastgeber"
              hint="Nur du und die Admins sehen diesen Teil."
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <GlassCard variant="tile" className="space-y-5 p-5">
                {!view.cancelled && (
                  <div className="space-y-4">
                    <h3 className="flex items-center gap-2 font-bold">
                      <Store className="text-primary size-4" /> Was gibt’s?
                    </h3>
                    <RestaurantPicker
                      date={date}
                      restaurantId={view.restaurant?.id ?? null}
                      restaurants={restaurants.map(({ id, name }) => ({ id, name }))}
                      hasOrders={allItems.length > 0}
                      disabled={view.locked}
                    />
                    <details className="group border-border/60 rounded-xl border p-3" open={flat}>
                      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
                        <Flame className="text-primary size-4" /> Oder Pauschale, z. B. Grillen
                      </summary>
                      <div className="mt-3">
                        <FlatForm
                          date={date}
                          title={view.flatTitle}
                          priceCents={view.flatPriceCents}
                          hasOrders={allItems.length > 0}
                          disabled={view.locked}
                        />
                      </div>
                    </details>
                  </div>
                )}
                <HostPicker
                  date={date}
                  hostId={hostId}
                  hostIsDefault={view.hostIsDefault}
                  defaultHostName={defaultHost?.name ?? null}
                  members={members
                    .filter((member) => member.active)
                    .map(({ id, name }) => ({ id, name }))}
                />
                <NoteEditor date={date} note={view.note} />
                <CancelToggle date={date} cancelled={view.cancelled} reason={view.cancelReason} />
              </GlassCard>

              {!view.cancelled && !flat && view.restaurant && (
                <GlassCard variant="tile" className="space-y-4 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 font-bold">
                      <ShoppingBag className="text-primary size-4" /> Bestellliste
                    </h3>
                    {sheet.length > 0 && <CopyButton text={orderSheetText(sheet)} />}
                  </div>
                  {sheet.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Noch nichts bestellt.</p>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {sheet.map((line) => (
                        <li key={line.key} className="flex gap-2">
                          <span className="text-primary w-7 shrink-0 font-extrabold tabular-nums">
                            {line.count}×
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="font-semibold">{line.name}</span>
                            {(line.options.length > 0 || line.notes.length > 0) && (
                              <span className="text-muted-foreground block text-xs">
                                {[...line.options, ...line.notes.map((note) => `„${note}“`)].join(
                                  ' · '
                                )}
                              </span>
                            )}
                            <span className="text-muted-foreground block text-xs">
                              {line.people.join(', ')}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {closed && sheet.length > 0 && (
                    <div className="border-border/60 border-t pt-4">
                      <h3 className="mb-3 flex items-center gap-2 font-bold">
                        <Receipt className="text-primary size-4" /> Abrechnen
                      </h3>
                      <SettleForm
                        date={date}
                        initial={centsToInput(view.finalTotalCents)}
                        settled={view.settled}
                      />
                    </div>
                  )}
                  {!view.host?.paypalMe && (
                    <p className="text-warning text-xs font-semibold">
                      {amHost
                        ? 'Trag in deinem Profil deinen PayPal.me-Namen ein, sonst gibt es keine Zahlungslinks.'
                        : `${view.host?.name ?? 'Der Gastgeber'} hat keinen PayPal.me-Namen im Profil, also gibt es keine Zahlungslinks.`}
                    </p>
                  )}
                </GlassCard>
              )}
            </div>
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
    </>
  );
}
