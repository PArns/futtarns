'use client';

import { Check, Wallet } from 'lucide-react';
import { payAction } from '@/app/actions';
import { Button, buttonVariants } from '@/components/ui/button';
import type { Money } from '@/lib/balance';
import { formatEuro } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { paypalMeLink } from '@/lib/paypal';
import { cn } from '@/lib/utils';

/**
 * Paying up front: what is open and what it is made of, one PayPal.me link for the sum,
 * and the button that books it once the money is sent.
 */
export function PayBox({
  date,
  memberId,
  money,
  payeeName,
  paypalMe,
  label = 'Jetzt zahlen',
}: {
  date: string;
  memberId: number;
  money: Money;
  payeeName: string;
  paypalMe: string | null;
  label?: string;
}) {
  const { pending, execute } = useAction();
  const lines = [
    { label: 'Essen inkl. Gebühren und Trinkgeld', cents: money.foodCents },
    { label: 'Getränkepauschale', cents: money.drinksCents },
    { label: 'Schon bezahlt', cents: -money.paidCents },
  ].filter((line) => line.cents !== 0);

  return (
    <div className="border-primary/40 bg-primary/10 space-y-4 rounded-2xl border p-4 sm:p-5">
      <div>
        <div className="text-primary text-[11px] font-bold tracking-[0.14em] uppercase">
          {label}
        </div>
        <div className="text-3xl font-extrabold tracking-tight tabular-nums">
          {formatEuro(money.openCents)}
        </div>
        <div className="text-muted-foreground text-xs">an {payeeName}</div>
      </div>
      {lines.length > 1 && (
        <dl className="border-primary/20 space-y-1 border-t pt-3 text-sm">
          {lines.map((line) => (
            <div key={line.label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{line.label}</dt>
              <dd className="tabular-nums">{formatEuro(line.cents)}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        {paypalMe && (
          <a
            href={paypalMeLink(paypalMe, money.openCents)}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ size: 'xl' }), 'flex-1')}
          >
            <Wallet /> Mit PayPal zahlen
          </a>
        )}
        <Button
          variant="outline"
          size="xl"
          disabled={pending}
          onClick={() => execute(() => payAction(date, memberId, money.openCents))}
          className="flex-1"
        >
          <Check /> Hab bezahlt
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {paypalMe
          ? 'Bitte in PayPal „Freunde und Familie“ auswählen, sonst gehen Gebühren ab. Danach auf „Hab bezahlt“ tippen.'
          : `${payeeName} hat noch keinen PayPal.me-Namen hinterlegt. Gib das Geld direkt und tipp dann auf „Hab bezahlt“.`}
      </p>
    </div>
  );
}
