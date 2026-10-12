import { CircleCheck, MessageCircle, PlugZap, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { AutoRefresh } from '@/components/common/auto-refresh';
import { buttonVariants } from '@/components/ui/button';
import { RelinkWhatsApp } from '@/components/people/relink-whatsapp';
import { GlassCard } from '@/components/ui/glass-card';
import { formatPhone } from '@/lib/phone';
import { botState } from '@/lib/whatsapp';

/** For admins: is the bot linked, and if not, the QR or pairing code to link it, kept current. */
export async function WhatsAppCard() {
  const state = await botState();
  return (
    <GlassCard variant="tile" className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <MessageCircle className="text-primary size-5" />
        <div className="flex-1 font-bold">WhatsApp-Bot</div>
        {state.kind === 'connected' ? (
          <span className="text-success inline-flex items-center gap-1 text-sm font-semibold">
            <CircleCheck className="size-4" /> verbunden
            {state.number && (
              <span className="text-muted-foreground font-normal">
                als {formatPhone(state.number)}
              </span>
            )}
          </span>
        ) : state.kind !== 'off' ? (
          <Link
            href="/leute#whatsapp"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <RefreshCw /> Neu laden
          </Link>
        ) : null}
      </div>
      {state.kind === 'off' && (
        <p className="text-muted-foreground text-sm">
          Läuft ohne Bot (<code>WHATSAPP=off</code> oder lokale Entwicklung): Nachrichten landen nur
          im Log.
        </p>
      )}
      {state.kind === 'unreachable' && (
        <p className="text-warning flex items-center gap-2 text-sm font-semibold">
          <PlugZap className="size-4" /> Der Bot antwortet nicht. Er startet sich selbst neu; schau
          gleich nochmal.
        </p>
      )}
      {state.kind === 'linking' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
          {state.qrSvg ? (
            <div
              className="size-52 rounded-xl bg-white p-2 [&>svg]:size-full"
              // The SVG comes from our own bot container, rendered by the qrcode package.
              dangerouslySetInnerHTML={{ __html: state.qrSvg }}
            />
          ) : state.pairingCode ? (
            <div>
              <div className="text-3xl font-extrabold tracking-[0.3em] tabular-nums">
                {state.pairingCode}
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {state.pairingPhone && `Für ${formatPhone(state.pairingPhone)}. `}
                Gilt gut zwei Minuten, danach steht hier von selbst ein neuer.
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Der Bot bereitet die Verbindung vor …</p>
          )}
          <ol className="text-muted-foreground list-inside list-decimal space-y-1 text-sm">
            <li>
              {state.pairingPhone
                ? `WhatsApp auf dem Handy mit ${formatPhone(state.pairingPhone)} öffnen.`
                : 'WhatsApp auf dem Handy des Bots öffnen (am besten eine eigene Nummer).'}
            </li>
            <li>Einstellungen → Verknüpfte Geräte → Gerät hinzufügen.</li>
            <li>
              {state.pairingCode
                ? '„Stattdessen mit Telefonnummer verknüpfen“ und den Code eingeben.'
                : 'Den Code scannen.'}
            </li>
            <li>Diese Seite merkt das von selbst, dann steht hier „verbunden“.</li>
          </ol>
        </div>
      )}
      {(state.kind === 'connected' || state.kind === 'linking') && (
        <RelinkWhatsApp linked={state.kind === 'connected'} />
      )}
      {(state.kind === 'linking' || state.kind === 'unreachable') && <AutoRefresh />}
    </GlassCard>
  );
}
