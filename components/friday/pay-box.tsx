'use client';

import { Check, Wallet } from 'lucide-react';
import { payAction } from '@/app/actions';
import { AmountRow } from '@/components/ui/amount-row';
import { Button, buttonVariants } from '@/components/ui/button';
import { payeePurpose, type MoneyLine, type Payee } from '@/lib/balance';
import { formatEuro } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { paypalMeLink } from '@/lib/paypal';
import { cn } from '@/lib/utils';

/**
 * What someone pays and what it is made of. Once paying is open it adds a PayPal.me link
 * per payee (the food can go to whoever fetched it, the drinks to the host) and the button
 * that books it all; before that, and for whoever paid the restaurant, it only explains
 * the amount.
 */
export function PayBox({
  date,
  memberId,
  amountCents,
  lines,
  payees,
  label = 'Jetzt zahlen',
  payable = true,
  note,
  maybe = false,
}: {
  date: string;
  memberId: number;
  amountCents: number;
  lines: MoneyLine[];
  payees: Payee[];
  label?: string;
  payable?: boolean;
  /** Shown instead of the pay buttons when paying is not open. */
  note?: string;
  /** Only what it would come to, e.g. if another restaurant wins: drawn quieter. */
  maybe?: boolean;
}) {
  const { pending, execute } = useAction();
  const split = payees.length > 1;
  const withoutPaypal = payees.filter((payee) => !payee.paypalMe);

  return (
    <div
      className={cn(
        'space-y-4 rounded-2xl border p-4 sm:p-5',
        maybe ? 'border-primary/30 border-dashed' : 'border-primary/40 bg-primary/10'
      )}
    >
      <div>
        <div className="text-primary text-[11px] font-bold tracking-[0.14em] uppercase">
          {label}
        </div>
        <div
          className={cn(
            'font-extrabold tracking-tight tabular-nums',
            maybe ? 'text-2xl' : 'text-3xl'
          )}
        >
          {formatEuro(amountCents)}
        </div>
        {payees.map((payee) => (
          <div key={payee.what} className="text-muted-foreground text-xs">
            {split && `${formatEuro(payee.cents)} ${payeePurpose(payee.what)} `}an {payee.name}
          </div>
        ))}
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
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {payees.map(
              (payee) =>
                payee.paypalMe && (
                  <a
                    key={payee.what}
                    href={paypalMeLink(payee.paypalMe, payee.cents)}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ size: 'xl' }), 'sm:flex-1')}
                  >
                    <Wallet />
                    {split ? `${formatEuro(payee.cents)} an ${payee.name}` : 'Mit PayPal zahlen'}
                  </a>
                )
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
            {withoutPaypal.length === 0
              ? 'Bitte in PayPal „Freunde und Familie“ auswählen, sonst gehen Gebühren ab. Danach auf „Hab bezahlt“ tippen.'
              : `${withoutPaypal.map((payee) => payee.name).join(' und ')} ${withoutPaypal.length > 1 ? 'haben' : 'hat'} noch keinen PayPal.me-Namen hinterlegt. Gib das Geld direkt und tipp dann auf „Hab bezahlt“.`}
          </p>
        </>
      )}
    </div>
  );
}
