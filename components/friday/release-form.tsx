'use client';

import { BellOff, CheckCircle2, RefreshCw, Send } from 'lucide-react';
import { releasePaymentAction, resendPayLinksAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/input';
import { useAction } from '@/lib/hooks/use-action';

/**
 * The host releases paying once orders and prices are right: with the payment links by
 * WhatsApp (and the reminders after them) or silently. A silent release can still send them,
 * and after prices changed the links go out again with the new amounts.
 */
export function ReleaseForm({
  date,
  released,
  notify,
}: {
  date: string;
  released: boolean;
  notify: boolean;
}) {
  const { pending, execute } = useAction();
  if (released && notify) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="text-primary size-4" /> Freigegeben, die Zahl-Links sind raus.
        </p>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => execute(() => resendPayLinksAction(date))}
        >
          <RefreshCw /> Zahl-Links neu schicken
        </Button>
        <Hint>
          Preise geändert? Dann bekommt jeder, dessen Betrag sich geändert hat, den neuen als
          Korrektur. Die anderen bekommen nichts.
        </Hint>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button disabled={pending} onClick={() => execute(() => releasePaymentAction(date, true))}>
          <Send /> {released ? 'Zahl-Links doch schicken' : 'Freigeben + Link schicken'}
        </Button>
        {!released && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => execute(() => releasePaymentAction(date, false))}
          >
            <BellOff /> Freigeben ohne Nachricht
          </Button>
        )}
      </div>
      <Hint>
        {released
          ? 'Freigegeben ohne Nachricht: Bezahlen geht, aber der Bot schickt keine Zahl-Links und keine Erinnerungen.'
          : 'Erst nach der Freigabe kann bezahlt werden. Prüf vorher die Bestellungen und Preise. Gibst du nicht frei, gehen die Zahl-Links morgen um 10 Uhr von selbst raus.'}
      </Hint>
    </div>
  );
}
