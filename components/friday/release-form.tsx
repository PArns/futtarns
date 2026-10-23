'use client';

import { BellOff, CheckCircle2, Send } from 'lucide-react';
import { releasePaymentAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/input';
import { useAction } from '@/lib/hooks/use-action';

/**
 * The host releases paying once orders and prices are right: with the payment links by
 * WhatsApp (and the reminders after them) or silently. A silent release can still send them.
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
      <p className="flex items-center gap-2 text-sm">
        <CheckCircle2 className="text-primary size-4" /> Freigegeben, die Zahl-Links sind raus.
      </p>
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
          : 'Erst nach der Freigabe kann bezahlt werden. Prüf vorher die Bestellungen und Preise.'}
      </Hint>
    </div>
  );
}
