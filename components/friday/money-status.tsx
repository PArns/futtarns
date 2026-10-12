'use client';

import { Beer, Check, Clock, RotateCcw, Undo2 } from 'lucide-react';
import { clearPaymentsAction, settleUpAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import type { Money } from '@/lib/balance';
import { formatEuro } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { cn } from '@/lib/utils';

const pill =
  'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-bold max-sm:h-8';

/** Paid, open or due back, plus the host's buttons to book or undo it. */
export function MoneyStatus({
  date,
  memberId,
  money,
  isHost,
  canManage,
}: {
  date: string;
  memberId: number;
  money: Money;
  isHost: boolean;
  canManage: boolean;
}) {
  const { pending, execute } = useAction();
  const status = isHost ? (
    <span className={cn(pill, 'border-primary/40 bg-primary/10 text-primary')}>Gastgeber</span>
  ) : money.openCents > 0 ? (
    <span className={cn(pill, 'border-warning/40 bg-warning/10 text-warning')}>
      <Clock className="size-3.5" /> {formatEuro(money.openCents)} offen
    </span>
  ) : money.openCents < 0 ? (
    <span className={cn(pill, 'border-primary/40 bg-primary/10 text-primary')}>
      <Undo2 className="size-3.5" /> bekommt {formatEuro(-money.openCents)}
    </span>
  ) : money.dueCents > 0 ? (
    <span className={cn(pill, 'border-success/40 bg-success/10 text-success')}>
      <Check className="size-3.5" /> bezahlt
    </span>
  ) : null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', pending && 'opacity-60')}>
      {status}
      {money.drinksCents > 0 && (
        <span className={cn(pill, 'border-border text-muted-foreground')} title="Für die Getränke">
          <Beer className="size-3.5" /> {formatEuro(money.drinksCents)}
        </span>
      )}
      {canManage && !isHost && money.openCents !== 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs max-sm:h-8"
          disabled={pending}
          title={money.openCents > 0 ? 'Als bezahlt markieren' : 'Als zurückgezahlt markieren'}
          onClick={() => execute(() => settleUpAction(date, memberId))}
        >
          <Check /> {money.openCents > 0 ? 'Hat bezahlt' : 'Zurückgezahlt'}
        </Button>
      )}
      {canManage && !isHost && money.paidCents !== 0 && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label="Zahlungen zurücksetzen"
          title="Zahlungen zurücksetzen"
          disabled={pending}
          onClick={() => {
            if (window.confirm('Alle Zahlungen dieser Person für diesen Freitag löschen?')) {
              execute(() => clearPaymentsAction(date, memberId));
            }
          }}
        >
          <RotateCcw />
        </Button>
      )}
    </div>
  );
}
