'use client';

import { Check } from 'lucide-react';
import { settleDebtAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { useAction } from '@/lib/hooks/use-action';

/** Ticks off one open debt of an earlier Friday: received, or paid back when negative. */
export function SettleDebtButton({
  date,
  memberId,
  payeeId,
  owes,
}: {
  date: string;
  memberId: number;
  payeeId: number | null;
  /** Positive: they still have to pay; otherwise they get money back. */
  owes: boolean;
}) {
  const { pending, execute } = useAction();
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-2.5 text-xs max-sm:h-8"
      disabled={pending}
      title={owes ? 'Als bezahlt markieren' : 'Als zurückgezahlt markieren'}
      onClick={() => execute(() => settleDebtAction(date, memberId, payeeId))}
    >
      <Check /> {owes ? 'Bezahlt' : 'Zurückgezahlt'}
    </Button>
  );
}
