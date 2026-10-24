import { Check, Clock, CupSoda, House, ShoppingBag, Vote } from 'lucide-react';
import { AnswerSelect } from '@/components/friday/answer-select';
import { DrinksToggle } from '@/components/friday/drinks-toggle';
import { MoneyStatus } from '@/components/friday/money-status';
import { OrderedItems, type OrderGroup } from '@/components/friday/ordered-items';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Pill } from '@/components/ui/pill';
import { lateLabel } from '@/lib/arrival';
import { collecting } from '@/lib/balance';
import { formatEuro } from '@/lib/format';
import type { FridayView, Participant } from '@/lib/services/fridays';
import { cn } from '@/lib/utils';

const STATUS_BADGE = {
  in: { label: 'Dabei', variant: 'softSuccess' },
  nofood: { label: 'Ohne Essen', variant: 'soft' },
  out: { label: 'Raus', variant: 'outline' },
} as const;

function subline(participant: Participant, nameOf: (id: number) => string) {
  if (participant.member.kind === 'guest' || !participant.member.core) {
    return `Gast${participant.addedById ? ` von ${nameOf(participant.addedById)}` : ''}`;
  }
  if (participant.attendance.reason === 'absent') return 'abwesend eingetragen';
  if (participant.attendance.reason === 'silent') {
    return participant.projectedDefault
      ? `noch keine Antwort · Standard: ${participant.projectedDefault.name}`
      : 'noch keine Antwort';
  }
  return '';
}

/**
 * The money of whoever collects it is the others': what is still to collect, and for the
 * host the drinks kitty, which they buy the drinks from. Whoever fetches the food collects
 * the food money.
 */
function PayeeMoney({
  view,
  memberId,
  isHost,
  isPicker,
}: {
  view: FridayView;
  memberId: number;
  isHost: boolean;
  isPicker: boolean;
}) {
  const { openCents, anyDue } = collecting(view, memberId);
  return (
    <>
      {isHost && (
        <Pill tone="primary">
          <House /> Gastgeber
        </Pill>
      )}
      {isPicker && (
        <Pill tone="primary">
          <ShoppingBag /> holt ab
        </Pill>
      )}
      {openCents > 0 ? (
        <Pill tone="warning">
          <Clock /> bekommt noch {formatEuro(openCents)}
        </Pill>
      ) : (
        anyDue && (
          <Pill tone="success">
            <Check /> alles eingesammelt
          </Pill>
        )
      )}
      {isHost && view.drinksFeeCents > 0 && (
        <Pill tone="muted">
          <CupSoda /> Getränkekasse {formatEuro(view.drinksTotalCents)}
        </Pill>
      )}
    </>
  );
}

/**
 * One person on the Friday as a compact row: answer, what they ordered, where their money
 * stands. Every row looks the same, the viewer's own included; the answer switch and the
 * buttons on the dishes show only where the viewer may change them.
 */
export function ParticipantCard({
  participant,
  view,
  canEdit,
  canManage,
  payable,
  nameOf,
  orders,
  ahead,
  titled,
}: {
  participant: Participant;
  view: FridayView;
  canEdit: boolean;
  canManage: boolean;
  /** Paying is open (the host released it), so the host may book payments. */
  payable: boolean;
  nameOf: (id: number) => string;
  /** What they ordered, by restaurant once they also ordered ahead during the vote. */
  orders: OrderGroup[];
  /** Roughly what they pay if a restaurant they ordered ahead from wins. */
  ahead: { name: string; cents: number }[];
  /** Name the restaurant over every order, as while the vote runs. */
  titled: boolean;
}) {
  const isHost = participant.member.id === view.host?.id;
  const isPicker = view.pickup && participant.member.id === view.picker?.id;
  const silentOnFlat = view.mode === 'flat' && participant.attendance.reason === 'silent';
  const badge = silentOnFlat
    ? { label: 'Offen', variant: 'outline' as const }
    : STATUS_BADGE[participant.attendance.status];
  const money = participant.money;
  const showMoney = money.dueCents !== 0 || money.paidCents !== 0;
  // Whether they chip into the drinks kitty shows for everyone; who may change it gets a switch.
  const inKitty =
    !isHost &&
    !view.cancelled &&
    participant.attendance.status !== 'out' &&
    view.drinksFeeCents > 0;
  const showDrinks = canEdit && inKitty;
  const showKitty = !canEdit && inKitty;
  const showPayeeMoney = (isHost || isPicker) && !view.cancelled;
  const sub = subline(participant, nameOf);

  return (
    <li
      className={cn(
        'flex min-w-0 gap-3 py-3',
        participant.attendance.status === 'out' && !silentOnFlat && 'opacity-60'
      )}
    >
      <Avatar name={participant.member.name} id={participant.member.id} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-bold">{participant.member.name}</span>
              {isHost && (
                <House className="text-primary size-3.5 shrink-0" aria-label="Gastgeber" />
              )}
              {isPicker && (
                <ShoppingBag className="text-primary size-3.5 shrink-0" aria-label="Holt ab" />
              )}
            </div>
            {participant.late && (
              <p className="text-primary flex items-center gap-1 text-xs font-semibold">
                <Clock className="size-3.5 shrink-0" />
                {lateLabel(participant.arrivesAt)}
              </p>
            )}
            {sub && <p className="text-muted-foreground truncate text-xs">{sub}</p>}
          </div>
          {canEdit ? (
            <AnswerSelect
              date={view.date}
              memberId={participant.member.id}
              status={participant.attendance.status}
            />
          ) : (
            <Badge variant={badge.variant} className="shrink-0">
              {badge.label}
            </Badge>
          )}
        </div>
        <OrderedItems
          groups={orders}
          editable={canEdit}
          prices={canManage && canEdit}
          titled={titled}
        />
        {(showMoney || showDrinks || showKitty || showPayeeMoney || ahead.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {showPayeeMoney && (
              <PayeeMoney
                view={view}
                memberId={participant.member.id}
                isHost={isHost}
                isPicker={isPicker}
              />
            )}
            {showMoney && (
              <MoneyStatus
                date={view.date}
                memberId={participant.member.id}
                money={money}
                canManage={canManage && payable}
                payable={payable}
              />
            )}
            {ahead.map((entry) => (
              <Pill key={entry.name} tone="muted">
                <Vote /> falls {entry.name}: ~{formatEuro(entry.cents)}
              </Pill>
            ))}
            {showKitty &&
              (participant.drinksOptOut ? (
                <Pill
                  tone="muted"
                  className="line-through"
                  title="Zahlt nicht in die Getränkekasse"
                >
                  <CupSoda /> Getränkekasse
                </Pill>
              ) : (
                <Pill tone="success" title="Zahlt in die Getränkekasse">
                  <CupSoda /> Getränkekasse
                </Pill>
              ))}
            {showDrinks && (
              <DrinksToggle
                date={view.date}
                memberId={participant.member.id}
                feeCents={view.drinksFeeCents}
                on={!participant.drinksOptOut}
                size="mini"
              />
            )}
          </div>
        )}
      </div>
    </li>
  );
}
