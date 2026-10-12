import { House } from 'lucide-react';
import { AnswerSelect } from '@/components/friday/answer-select';
import { DrinksToggle } from '@/components/friday/drinks-toggle';
import { ItemRow } from '@/components/friday/item-row';
import { MoneyStatus } from '@/components/friday/money-status';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { GlassCard } from '@/components/ui/glass-card';
import type { FridayView, Participant } from '@/lib/services/fridays';
import { cn } from '@/lib/utils';

const STATUS_BADGE = {
  in: { label: 'Dabei', variant: 'softSuccess' },
  nofood: { label: 'Ohne Essen', variant: 'soft' },
  out: { label: 'Raus', variant: 'outline' },
} as const;

function subline(participant: Participant, view: FridayView, nameOf: (id: number) => string) {
  if (participant.member.kind === 'guest') {
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

/** One person on the Friday: answer, what they ordered, where their money stands. */
export function ParticipantCard({
  participant,
  view,
  isViewer,
  canEdit,
  canManage,
  nameOf,
}: {
  participant: Participant;
  view: FridayView;
  isViewer: boolean;
  canEdit: boolean;
  canManage: boolean;
  nameOf: (id: number) => string;
}) {
  const isHost = participant.member.id === view.host?.id;
  const silentOnFlat = view.mode === 'flat' && participant.attendance.reason === 'silent';
  const badge = silentOnFlat
    ? { label: 'Offen', variant: 'outline' as const }
    : STATUS_BADGE[participant.attendance.status];
  const editOthers = canEdit && !isViewer;
  const money = participant.money;
  const showMoney = !isHost && (money.dueCents !== 0 || money.paidCents !== 0);
  const showDrinks =
    editOthers && !isHost && participant.attendance.status !== 'out' && view.drinksFeeCents > 0;

  return (
    <GlassCard
      variant="tile"
      className={cn(
        'min-w-0 p-4',
        participant.attendance.status === 'out' && !silentOnFlat && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar name={participant.member.name} id={participant.member.id} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-bold">{participant.member.name}</span>
            {isHost && <House className="text-primary size-3.5 shrink-0" aria-label="Gastgeber" />}
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
      {(showMoney || showDrinks) && (
        <div className="border-border/60 mt-3 space-y-2 border-t pt-3">
          {showMoney && (
            <MoneyStatus
              date={view.date}
              memberId={participant.member.id}
              money={money}
              isHost={isHost}
              canManage={canManage}
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
