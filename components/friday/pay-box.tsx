'use client';

import { Beer, Check, Wallet } from 'lucide-react';
import { useState } from 'react';
import { payAction } from '@/app/actions';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DRINK_SUGGESTIONS } from '@/lib/balance';
import { formatEuro } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { parseEuroToCents } from '@/lib/menu/options';
import { paypalMeLink } from '@/lib/paypal';
import { cn } from '@/lib/utils';

/**
 * Paying up front: what is open, a drinks donation on top, one PayPal.me link for the
 * sum, and the button that books it once the money is sent.
 */
export function PayBox({
  date,
  openCents,
  payeeName,
  paypalMe,
  label,
}: {
  date: string;
  openCents: number;
  payeeName: string;
  paypalMe: string | null;
  label?: string;
}) {
  const [donation, setDonation] = useState(0);
  const [custom, setCustom] = useState('');
  const { pending, execute } = useAction();
  const owed = Math.max(0, openCents);
  const total = owed + donation;

  return (
    <div className="border-primary/40 bg-primary/10 space-y-4 rounded-2xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-primary text-[11px] font-bold tracking-[0.14em] uppercase">
            {label ?? (owed > 0 ? 'Jetzt zahlen' : 'Getränkekasse')}
          </div>
          <div className="text-3xl font-extrabold tracking-tight tabular-nums">
            {formatEuro(total)}
          </div>
          <div className="text-muted-foreground text-xs">
            an {payeeName}
            {owed > 0 &&
              donation > 0 &&
              ` · ${formatEuro(owed)} Essen + ${formatEuro(donation)} Getränke`}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Beer className="text-primary size-4" /> Was für die Getränke?
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[0, ...DRINK_SUGGESTIONS].map((cents) => (
            <button
              key={cents}
              type="button"
              onClick={() => {
                setDonation(cents);
                setCustom('');
              }}
              className={cn(
                'h-9 rounded-full border px-3.5 text-sm font-semibold tabular-nums transition-colors max-sm:h-10',
                donation === cents && !custom
                  ? 'border-primary/60 bg-primary text-primary-foreground'
                  : 'border-border bg-background/50 hover:border-primary/50'
              )}
            >
              {cents === 0 ? 'Nix' : `+${formatEuro(cents)}`}
            </button>
          ))}
          <Input
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value);
              const cents = parseEuroToCents(event.target.value);
              setDonation(cents !== null && cents > 0 ? Math.min(cents, 10_000) : 0);
            }}
            inputMode="decimal"
            placeholder="anderer Betrag"
            aria-label="Anderer Betrag für die Getränke"
            className="h-9 w-36 rounded-full max-sm:h-10"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {paypalMe && total > 0 && (
          <a
            href={paypalMeLink(paypalMe, total)}
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
          disabled={pending || total === 0}
          onClick={() => execute(() => payAction(date, donation))}
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
