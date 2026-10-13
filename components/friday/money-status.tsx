'use client';

import { Check, Clock, RotateCcw, Undo2 } from 'lucide-react';
import { clearPaymentsAction, settleUpAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import type { Money } from '@/lib/balance';
import { formatEuro } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { cn } from '@/lib/utils';

/** Paid, open or due back, plus the host's buttons to book or undo it. */
export function MoneyStatus({
  date,
  memberId,
  money,
  canManage,
}: {
  date: string;
  memberId: number;
  money: Money;
  canManage: boolean;
}) {
  const { pending, execute } = useAction();
  const status =
    money.openCents > 0 ? (
      <Pill tone="warning">
        <Clock /> {formatEuro(money.openCents)} offen
      </Pill>
    ) : money.openCents < 0 ? (
      <Pill tone="primary">
        <Undo2 /> bekommt {formatEuro(-money.openCents)}
      </Pill>
    ) : (
      <Pill tone="success">
        <Check /> {formatEuro(money.paidCents)} bezahlt
      </Pill>
    );

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', pending && 'opacity-60')}>
      {status}
      {canManage && money.openCents !== 0 && (
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
      {canManage && money.paidCents !== 0 && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 max-sm:size-8"
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
