import {
  BookOpen,
  CalendarDays,
  Check,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Coins,
  ExternalLink,
  Flame,
  House,
  Sparkles,
  Store,
  TriangleAlert,
  Users,
  UtensilsCrossed,
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
import { ItemRow } from '@/components/friday/item-row';
import { Menu } from '@/components/friday/menu';
import { MyMoney } from '@/components/friday/my-money';
import { ParticipantCard } from '@/components/friday/participant-card';
import { PayBox } from '@/components/friday/pay-box';
import { TimeLine } from '@/components/friday/time-line';
import { AttendancePills } from '@/components/common/attendance-pills';
import { ChapterHeading } from '@/components/common/chapter-heading';
import { PageHero } from '@/components/layout/page-hero';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { addWeeks, deliveryTime, isPastDeadline, type IsoDate } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import type { Member } from '@/lib/db/schema';
import { formatDayShort, formatEuro, formatTime } from '@/lib/format';
import { buildOrderSheet } from '@/lib/order-sheet';
import { canEditOrderOf, canManageFriday, canSetHost } from '@/lib/permissions';
import { loadFriday, openBalancesFor, type Participant } from '@/lib/services/fridays';
import { getDefaultHost, listMembers } from '@/lib/services/members';
import { getDefault } from '@/lib/services/orders';
import { listRestaurants } from '@/lib/services/restaurants';
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
  const lockState = { locked: closed, settled: view.settled };
  const flat = view.mode === 'flat';
  const me = view.participants.find((participant) => participant.member.id === viewer.id);
  const myDefault = view.restaurant ? await getDefault(db, viewer.id, view.restaurant.id) : null;
  const otherBalances = isCurrent ? await openBalancesFor(db, viewer.id, date, now) : [];
  const [restaurants, members, defaultHost] = await Promise.all([
    manage ? listRestaurants(db) : [],
    manage || swapHostOnly ? listMembers(db) : [],
    manage || swapHostOnly ? getDefaultHost(db) : null,
  ]);
  const hostOptions = members
    .filter((member) => member.active)
    .map(({ id, name }) => ({ id, name }));

  const takenBy: Record<number, string[]> = {};
  for (const participant of view.participants) {
    const label = participant.member.id === viewer.id ? 'Du' : participant.member.name;
    for (const item of participant.items) {
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
  const silent = view.participants.filter(
    (p) => p.member.kind === 'member' && p.attendance.reason === 'silent'
  );
  const counted = (status: 'in' | 'nofood' | 'out') =>
    view.participants.filter(
      (p) => p.attendance.status === status && !(flat && p.attendance.reason === 'silent')
    ).length;
  const countHint = [
    `${counted('in')} ${flat ? 'dabei' : 'essen mit'}`,
    `${counted('nofood')} ohne Essen`,
    `${counted('out')} raus`,
    ...(silent.length ? [`${silent.length} ohne Antwort`] : []),
  ].join(' · ');
  const visibleParticipants = view.participants.filter(
    (participant) => participant.member.kind === 'member' || participant.attendance.status !== 'out'
  );
  const attendancePeople = visibleParticipants.map((participant) => ({
    id: participant.member.id,
    name: participant.member.name,
    status: participant.attendance.status,
    answered: participant.attendance.reason === 'answered',
  }));
  const sheet = buildOrderSheet(
    view.participants.flatMap((participant) => participant.items),
    nameOf
  );
  const hungry = closed
    ? []
    : view.participants.filter(
        (entry) =>
          entry.attendance.status === 'in' &&
          entry.items.length === 0 &&
          !entry.projectedDefault &&
          entry.member.id !== hostId
      );
  const amHost = viewer.id === hostId;
  const title = view.cancelled
    ? 'Fällt aus'
    : flat
      ? (view.flatTitle ?? 'Pauschale')
      : (view.restaurant?.name ?? 'Was essen wir?');

  const silentHint = !me
    ? ''
    : flat
      ? `Für ${view.flatTitle ?? 'diesen Abend'} brauchen wir deine Zusage, sonst planen wir dich nicht ein.`
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
  const payDone =
    amHost ||
    (me
      ? me.money.openCents <= 0 && (me.money.dueCents > 0 || me.attendance.status === 'out')
      : false);

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
        title={title}
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
          {view.host && (
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
        {!view.cancelled && (
          <div className="hero-item mt-2">
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
                        label: 'Bestellung',
                        at: view.orderTime.getTime(),
                        time: formatTime(view.orderTime),
                      },
                      {
                        label: 'Essen ~',
                        at: deliveryTime(date).getTime(),
                        time: formatTime(deliveryTime(date)),
                      },
                    ]),
              ]}
            />
          </div>
        )}

        <div className="hero-item mt-4">
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

        {!view.cancelled && attendancePeople.length > 0 && (
          <div className="hero-item mt-4">
            <AttendancePills people={attendancePeople} />
          </div>
        )}

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
                { label: 'Zahlen', done: payDone },
              ]}
            />
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
        {view.cancelled && me && (
          <div className="hero-item mt-5">
            <MyMoney view={view} me={me} canEdit={false} />
          </div>
        )}
      </PageHero>

      <div className="mx-auto max-w-5xl space-y-12 px-4">
        {otherBalances.length > 0 && (
          <GlassCard variant="tile" className="border-warning/40 space-y-4 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Wallet className="text-warning size-4" /> Von früheren Freitagen
            </div>
            {otherBalances.map((balance) => {
              const forGuest = balance.member.id !== viewer.id;
              return (
                <div key={`${balance.fridayDate}-${balance.member.id}`}>
                  <Link
                    href={`/freitag/${balance.fridayDate}`}
                    className="hover:text-primary mb-2 block text-sm"
                  >
                    {formatDayShort(balance.fridayDate)} · {balance.title}
                    {forGuest && ` · für ${balance.member.name}`}
                  </Link>
                  {balance.money.openCents > 0 && balance.payee ? (
                    <PayBox
                      date={balance.fridayDate}
                      memberId={balance.member.id}
                      money={balance.money}
                      payeeName={balance.payee.name}
                      paypalMe={balance.payee.paypalMe}
                      label={forGuest ? `Noch offen für ${balance.member.name}` : 'Noch offen'}
                    />
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      {forGuest ? `${balance.member.name} bekommt` : 'Du bekommst'}{' '}
                      {formatEuro(-balance.money.openCents)} von{' '}
                      {balance.payee?.name ?? 'dem Gastgeber'} zurück.
                    </p>
                  )}
                </div>
              );
            })}
          </GlassCard>
        )}

        {!view.cancelled && me && (
          <section>
            <ChapterHeading
              number={++chapter}
              icon={flat ? Flame : UtensilsCrossed}
              kicker={flat ? 'Grillzeit' : 'Hunger?'}
              title={flat ? 'Dein Beitrag' : 'Deine Bestellung'}
              hint={
                flat
                  ? `${formatEuro(view.flatPriceCents ?? 0)} pro Person, für alle gleich.`
                  : !view.restaurant
                    ? 'Der Gastgeber sucht das Restaurant noch aus.'
                    : closed
                      ? 'Bestellschluss ist vorbei.'
                      : canOrder && (
                          <>
                            Such dir{' '}
                            <a href="#karte" className="text-primary font-semibold hover:underline">
                              auf der Karte
                            </a>{' '}
                            was aus.
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
              {!flat && me.items.length > 0 && (
                <div>
                  <ul className="divide-border/50 divide-y">
                    {me.items.map((item) => (
                      <ItemRow key={item.id} item={item} editable={editable(me)} />
                    ))}
                  </ul>
                  {me.share && (
                    <div className="border-border/60 mt-2 flex items-baseline justify-between gap-3 border-t pt-3 text-sm">
                      <span className="text-muted-foreground">
                        {view.settled
                          ? 'Dein Essen'
                          : 'Mit deinem Anteil an Gebühren und Trinkgeld'}
                      </span>
                      <span className="shrink-0 text-lg font-extrabold tabular-nums">
                        {formatEuro(me.share.totalCents)}
                      </span>
                    </div>
                  )}
                </div>
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
                      wählst.
                    </span>
                  </p>
                )}
              {!flat &&
                me.items.length === 0 &&
                !myDefault?.dish &&
                me.attendance.status === 'in' &&
                view.restaurant && (
                  <p className="text-muted-foreground text-sm">Noch nichts ausgesucht.</p>
                )}
              {!flat &&
                me.items.length === 0 &&
                view.restaurant &&
                (me.attendance.status === 'out' ||
                  (me.attendance.status === 'nofood' && me.attendance.reason !== 'silent')) && (
                  <p className="text-muted-foreground text-sm">
                    {me.attendance.status === 'out'
                      ? 'Du bist diesmal raus. Kommst du doch, such dir unten einfach was aus.'
                      : 'Du kommst ohne Essen. Kriegst du doch Hunger, such dir unten was aus.'}
                  </p>
                )}
              {!flat && !view.restaurant && (
                <p className="flex items-center gap-2 text-sm">
                  <Store className="text-primary size-4 shrink-0" />
                  Sobald das Restaurant feststeht, kannst du hier aussuchen.
                </p>
              )}
              <MyMoney view={view} me={me} canEdit={editable(me)} />
            </GlassCard>
          </section>
        )}

        {!view.cancelled && (view.estimate || flat) && (
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
                    : 'Geschätzt aus der Karte; nach der Bestellung wird mit dem echten Betrag abgerechnet.'
              }
            />
            <CostsSection view={view} />
          </section>
        )}

        {me && view.restaurant && canOrder && (
          <section id="karte" className="scroll-mt-16">
            <ChapterHeading
              number={++chapter}
              icon={BookOpen}
              kicker="Die Karte"
              title={view.restaurant.name}
              hint={
                closed
                  ? 'Bestellschluss ist vorbei, als Gastgeber kannst du noch nachtragen.'
                  : 'Tippe auf ein Gericht, um es zu bestellen.'
              }
            />
            <Menu
              dishes={view.dishes}
              mode="order"
              date={date}
              restaurantId={view.restaurant.id}
              targets={targets}
              initialTargetId={targets[0]!.id}
              defaultDishId={myDefault?.dish?.id ?? null}
              takenBy={takenBy}
            />
          </section>
        )}

        {!view.cancelled && (
          <section>
            <ChapterHeading
              number={++chapter}
              icon={Users}
              kicker="Die Bande"
              title="Wer ist dabei"
              hint={countHint}
            />
            <div className="mb-4">
              <AttendancePills people={attendancePeople} />
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleParticipants.map((participant) => (
                <ParticipantCard
                  key={participant.member.id}
                  participant={participant}
                  view={view}
                  isViewer={participant.member.id === viewer.id}
                  canEdit={editable(participant)}
                  canManage={manage}
                  nameOf={nameOf}
                />
              ))}
            </div>
            {(!closed || manage) && (
              <div className="mt-4 max-w-md">
                <AddGuestForm date={date} />
              </div>
            )}
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
              hungry={hungry}
              restaurants={restaurants.map(({ id, name }) => ({
                id,
                name,
                isDefault: id === view.host?.defaultRestaurantId,
              }))}
              members={hostOptions}
              defaultHostName={defaultHost?.name ?? null}
              viewerIsHost={amHost}
            />
          </section>
        )}

        {swapHostOnly && !view.settled && (
          <section>
            <ChapterHeading
              number={++chapter}
              icon={House}
              kicker="Vertretung"
              title="Wer ist Gastgeber?"
              hint="Mit der Rolle Gastgeber kannst du diesen Freitag jemand anderem geben."
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
    </>
  );
}
