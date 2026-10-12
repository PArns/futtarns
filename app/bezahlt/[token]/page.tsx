import { Check, PartyPopper, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { payByLinkAction } from '@/app/actions';
import { LoginShell } from '@/components/login/login-shell';
import { Button, buttonVariants } from '@/components/ui/button';
import { getDb } from '@/lib/db';
import { formatDayShort, formatEuro } from '@/lib/format';
import { paypalMeLink } from '@/lib/paypal';
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

  const { view, entry } = opened;
  const open = entry.money.openCents;
  const forGuest = entry.member.kind === 'guest' ? ` für ${entry.member.name}` : '';
  const handle = view.host?.paypalMe;

  return (
    <LoginShell>
      <div className="hero-item mt-6 space-y-4">
        <p className="text-muted-foreground text-sm">
          Freitag, {formatDayShort(view.date)}
          {forGuest}
        </p>
        {open <= 0 ? (
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
            {handle && (
              <a
                href={paypalMeLink(handle, open)}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'outline', className: 'w-full' })}
              >
                Mit PayPal an {view.host?.name} zahlen
              </a>
            )}
            <form action={payByLinkAction.bind(null, token)}>
              <Button type="submit" size="lg" className="w-full">
                <Check /> Hab bezahlt
              </Button>
            </form>
            <p className="text-muted-foreground text-xs">
              {handle && 'In PayPal bitte „Freunde und Familie“ wählen. '}
              Nach „Hab bezahlt“ hören die Erinnerungen für diesen Freitag auf.
            </p>
          </>
        )}
      </div>
    </LoginShell>
  );
}
