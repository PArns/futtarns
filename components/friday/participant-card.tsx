import { Check, Clock, CupSoda, House, ShoppingBag } from 'lucide-react';
import { AnswerSelect } from '@/components/friday/answer-select';
import { DrinksToggle } from '@/components/friday/drinks-toggle';
import { ItemRow } from '@/components/friday/item-row';
import { MoneyStatus } from '@/components/friday/money-status';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { GlassCard } from '@/components/ui/glass-card';
import { Pill } from '@/components/ui/pill';
import { collecting } from '@/lib/balance';
import { formatEuro } from '@/lib/format';
import type { FridayView, Participant } from '@/lib/services/fridays';
import { cn } from '@/lib/utils';

const STATUS_BADGE = {
  in: { label: 'Dabei', variant: 'softSuccess' },
  nofood: { label: 'Ohne Essen', variant: 'soft' },
  out: { label: 'Raus', variant: 'outline' },
} as const;

function subline(participant: Participant, view: FridayView, nameOf: (id: number) => string) {
  if (participant.member.kind === 'guest' || !participant.member.core) {
    return `Gast${participant.addedById ? ` von ${nameOf(participant.addedById)}` : ''}`;
  }
  if (participant.attendance.reason === 'absent') return 'abwesend eingetragen';
  if (participant.attendance.reason === 'silent') {
    return participant.projectedDefault
      ? `noch keine Antwort · Standard: ${participant.projectedDefault.name}`
      : 'noch keine Antwort';
  }
  if (
    participant.drinksOptOut &&
    participant.attendance.status !== 'out' &&
    view.drinksFeeCents > 0
  ) {
    return 'ohne Getränkepauschale';
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
      <div className="flex flex-wrap items-center gap-1.5">
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
      </div>
      {isHost && view.drinksFeeCents > 0 && (
        <div className="border-primary/40 bg-primary/10 flex min-h-10 items-center gap-3 rounded-2xl border px-4 py-1.5">
          <CupSoda className="text-primary size-5 shrink-0" />
          <span className="flex-1 text-sm font-semibold">Getränkekasse</span>
          <span className="text-sm font-semibold tabular-nums">
            {formatEuro(view.drinksTotalCents)}
          </span>
        </div>
      )}
    </>
  );
}

/** One person on the Friday: answer, what they ordered, where their money stands. */
export function ParticipantCard({
  participant,
  view,
  isViewer,
  canEdit,
  canManage,
  payable,
  nameOf,
}: {
  participant: Participant;
  view: FridayView;
  isViewer: boolean;
  canEdit: boolean;
  canManage: boolean;
  /** Paying is open (from the deadline on), so the host may book payments. */
  payable: boolean;
  nameOf: (id: number) => string;
}) {
  const isHost = participant.member.id === view.host?.id;
  const isPicker = view.pickup && participant.member.id === view.picker?.id;
  const silentOnFlat = view.mode === 'flat' && participant.attendance.reason === 'silent';
  const badge = silentOnFlat
    ? { label: 'Offen', variant: 'outline' as const }
    : STATUS_BADGE[participant.attendance.status];
  const editOthers = canEdit && !isViewer;
  const money = participant.money;
  const showMoney = money.dueCents !== 0 || money.paidCents !== 0;
  const showDrinks =
    editOthers && !isHost && participant.attendance.status !== 'out' && view.drinksFeeCents > 0;
  const showPayeeMoney = (isHost || isPicker) && !view.cancelled;

  return (
    <GlassCard
      variant="tile"
      className={cn(
        // Cards in a row share its height; the money part sits at the bottom of each.
        'flex h-full min-w-0 flex-col p-4',
        participant.attendance.status === 'out' && !silentOnFlat && 'opacity-60'
      )}
    >
      <div className="flex-1">
        <div className="flex items-center gap-3">
          <Avatar name={participant.member.name} id={participant.member.id} />
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
            <div className="text-muted-foreground truncate text-xs">
              {subline(participant, view, nameOf)}
            </div>
          </div>
          {editOthers ? (
            <AnswerSelect
              date={view.date}
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
              <ItemRow key={item.id} item={item} editable={editOthers} />
            ))}
          </ul>
        )}
      </div>
      {(showMoney || showDrinks || showPayeeMoney) && (
        <div className="border-border/60 mt-3 space-y-2 border-t pt-3">
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
            />
          )}
          {showDrinks && (
            <DrinksToggle
              date={view.date}
              memberId={participant.member.id}
              feeCents={view.drinksFeeCents}
              on={!participant.drinksOptOut}
              compact
            />
          )}
        </div>
      )}
    </GlassCard>
  );
}
