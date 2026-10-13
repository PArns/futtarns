'use client';

import { Check, Wallet } from 'lucide-react';
import { payAction } from '@/app/actions';
import { AmountRow } from '@/components/ui/amount-row';
import { Button, buttonVariants } from '@/components/ui/button';
import type { MoneyLine } from '@/lib/balance';
import { formatEuro } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { paypalMeLink } from '@/lib/paypal';
import { cn } from '@/lib/utils';

/**
 * What someone pays and what it is made of. Once paying is open it adds one PayPal.me
 * link for the sum and the button that books it; before that, and for the host, it only
 * explains the amount.
 */
export function PayBox({
  date,
  memberId,
  amountCents,
  lines,
  payeeName,
  paypalMe,
  label = 'Jetzt zahlen',
  payable = true,
  note,
}: {
  date: string;
  memberId: number;
  amountCents: number;
  lines: MoneyLine[];
  payeeName: string | null;
  paypalMe: string | null;
  label?: string;
  payable?: boolean;
  /** Shown instead of the pay buttons when paying is not open. */
  note?: string;
}) {
  const { pending, execute } = useAction();

  return (
    <div className="border-primary/40 bg-primary/10 space-y-4 rounded-2xl border p-4 sm:p-5">
      <div>
        <div className="text-primary text-[11px] font-bold tracking-[0.14em] uppercase">
          {label}
        </div>
        <div className="text-3xl font-extrabold tracking-tight tabular-nums">
          {formatEuro(amountCents)}
        </div>
        {payeeName && <div className="text-muted-foreground text-xs">an {payeeName}</div>}
      </div>
      {lines.length > 0 && (
        <dl className="border-primary/20 space-y-1 border-t pt-3 text-sm">
          {lines.map((line) => (
            <AmountRow key={line.label} label={line.label} cents={line.cents} />
          ))}
        </dl>
      )}
      {!payable ? (
        note && <p className="text-muted-foreground text-xs">{note}</p>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            {paypalMe && (
              <a
                href={paypalMeLink(paypalMe, amountCents)}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ size: 'xl' }), 'sm:flex-1')}
              >
                <Wallet /> Mit PayPal zahlen
              </a>
            )}
            <Button
              variant="outline"
              size="xl"
              disabled={pending}
              onClick={() => execute(() => payAction(date, memberId))}
              className="sm:flex-1"
            >
              <Check /> Hab bezahlt
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {paypalMe
              ? 'Bitte in PayPal „Freunde und Familie“ auswählen, sonst gehen Gebühren ab. Danach auf „Hab bezahlt“ tippen.'
              : `${payeeName ?? 'Der Gastgeber'} hat noch keinen PayPal.me-Namen hinterlegt. Gib das Geld direkt und tipp dann auf „Hab bezahlt“.`}
          </p>
        </>
      )}
    </div>
  );
}
