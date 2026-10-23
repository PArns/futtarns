import { Check, Clock, PartyPopper, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { payByLinkAction } from '@/app/actions';
import { CopyButton } from '@/components/common/copy-button';
import { LoginShell } from '@/components/login/login-shell';
import { Button, buttonVariants } from '@/components/ui/button';
import { payeePurpose, payeesFor } from '@/lib/balance';
import { getDb } from '@/lib/db';
import { formatDayShort, formatEuro } from '@/lib/format';
import { paypalAmount, paypalMeLink } from '@/lib/paypal';
import { openPayLink } from '@/lib/services/pay-links';

export const metadata: Metadata = { title: 'Bezahlt?' };

/**
 * Where a payment reminder's link lands. Opening it only shows what is open; the button
 * books it, because chat apps open links for their previews.
 */
export default async function PaidLinkPage(props: PageProps<'/bezahlt/[token]'>) {
  const { token } = await props.params;
  const { ok } = await props.searchParams;
  const opened = await openPayLink(await getDb(), token, new Date());

  if (!opened) {
    return (
      <LoginShell>
        <div className="hero-item mt-6 space-y-3">
          <h1 className="text-xl font-bold">Der Link gilt nicht mehr</h1>
          <p className="text-muted-foreground text-sm">
            Melde dich an, dann siehst du auf der Seite, was noch offen ist.
          </p>
          <Link href="/" className={buttonVariants({ className: 'w-full' })}>
            Zur Seite
          </Link>
        </div>
      </LoginShell>
    );
  }

  const { view, entry, payable } = opened;
  const open = entry.money.openCents;
  const forGuest = entry.member.kind === 'guest' ? ` für ${entry.member.name}` : '';
  const payees = payeesFor(view, entry.money);

  return (
    <LoginShell>
      <div className="hero-item mt-6 space-y-4">
        <p className="text-muted-foreground text-sm">
          Freitag, {formatDayShort(view.date)}
          {forGuest}
        </p>
        {open > 0 && !payable ? (
          <>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <Clock className="text-primary size-5" /> Noch nicht
            </h1>
            <p className="text-muted-foreground text-sm">
              Bezahlt wird, sobald {view.host?.name ?? 'der Gastgeber'} die Zahlung freigibt, dann
              steht fest, was alle bestellt haben.
            </p>
          </>
        ) : open <= 0 ? (
          <>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <PartyPopper className="text-primary size-5" />
              {ok ? 'Danke, ist vermerkt!' : 'Hier ist nichts mehr offen'}
            </h1>
            <p className="text-muted-foreground text-sm">Dafür kommen keine Erinnerungen mehr.</p>
          </>
        ) : (
          <>
            <div>
              <h1 className="flex items-center gap-2 text-xl font-bold">
                <Wallet className="text-primary size-5" /> Noch offen
              </h1>
              <p className="mt-1 text-3xl font-extrabold tabular-nums">{formatEuro(open)}</p>
            </div>
            {payees.map(
              (payee) =>
                payee.paypalMe && (
                  <a
                    key={payee.what}
                    href={paypalMeLink(payee.paypalMe, payee.cents)}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: 'outline', className: 'w-full' })}
                  >
                    {payees.length > 1
                      ? `${formatEuro(payee.cents)} ${payeePurpose(payee.what)} an ${payee.name}`
                      : `Mit PayPal an ${payee.name} zahlen`}
                  </a>
                )
            )}
            {payees.some((payee) => payee.paypalMe) && (
              // The PayPal app opens the link but does not always take the amount over.
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                <span>Fehlt in der PayPal-App der Betrag?</span>
                {payees.map(
                  (payee) =>
                    payee.paypalMe && (
                      <CopyButton
                        key={payee.what}
                        text={paypalAmount(payee.cents)}
                        label={`${formatEuro(payee.cents)} kopieren`}
                      />
                    )
                )}
              </div>
            )}
            <form action={payByLinkAction.bind(null, token)}>
              <Button type="submit" size="lg" className="w-full">
                <Check /> Hab bezahlt
              </Button>
            </form>
            <p className="text-muted-foreground text-xs">
              {payees.some((payee) => payee.paypalMe) &&
                'In PayPal bitte „Freunde und Familie“ wählen. '}
              Nach „Hab bezahlt“ hören die Erinnerungen für diesen Freitag auf.
            </p>
          </>
        )}
      </div>
    </LoginShell>
  );
}
