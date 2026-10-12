'use client';

import { Receipt, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { reopenSettlementAction, settleAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/input';
import { useAction } from '@/lib/hooks/use-action';

export function SettleForm({
  date,
  initial,
  settled,
}: {
  date: string;
  initial: string;
  settled: boolean;
}) {
  const [total, setTotal] = useState(initial);
  const { pending, execute } = useAction();
  return (
    <div className="space-y-3">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          execute(() => settleAction(date, total));
        }}
      >
        <Label className="flex-1">
          Bezahlt bei Lieferando (inkl. Gebühren und Trinkgeld)
          <Input
            inputMode="decimal"
            value={total}
            onChange={(event) => setTotal(event.target.value)}
            placeholder="87,40"
            className="text-lg font-semibold tabular-nums"
          />
        </Label>
        <Button type="submit" disabled={pending || !total.trim()}>
          <Receipt /> {settled ? 'Neu verteilen' : 'Abrechnen'}
        </Button>
      </form>
      <Hint>
        Jeder zahlt seine Gerichte, der Rest (Liefergebühr, Service, Trinkgeld oder ein Rabatt) wird
        gleichmäßig auf alle verteilt, die gegessen haben.
      </Hint>
      {settled && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => execute(() => reopenSettlementAction(date))}
        >
          <RotateCcw /> Abrechnung öffnen, um Bestellungen zu korrigieren
        </Button>
      )}
    </div>
  );
}
