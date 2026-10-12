import { CircleCheck, MessageCircle, PlugZap, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { botGroups, botState } from '@/lib/whatsapp';

/** For admins: is the bot linked, and if not, the QR code to link it from a phone. */
export async function WhatsAppCard() {
  const state = await botState();
  const groups = state.kind === 'connected' ? await botGroups() : [];
  return (
    <GlassCard variant="tile" className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <MessageCircle className="text-primary size-5" />
        <div className="flex-1 font-bold">WhatsApp-Bot</div>
        {state.kind === 'connected' ? (
          <span className="text-success inline-flex items-center gap-1 text-sm font-semibold">
            <CircleCheck className="size-4" /> verbunden
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
            <div className="text-3xl font-extrabold tracking-[0.3em] tabular-nums">
              {state.pairingCode}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Der Bot bereitet die Verbindung vor …</p>
          )}
          <ol className="text-muted-foreground list-inside list-decimal space-y-1 text-sm">
            <li>WhatsApp auf dem Handy des Bots öffnen (am besten eine eigene Nummer).</li>
            <li>Einstellungen → Verknüpfte Geräte → Gerät hinzufügen.</li>
            <li>
              {state.pairingCode
                ? 'Mit Telefonnummer verknüpfen und den Code eingeben.'
                : 'Den Code scannen.'}
            </li>
            <li>Danach neu laden, hier steht dann „verbunden“.</li>
          </ol>
        </div>
      )}
      {groups.length > 0 && (
        <div className="text-sm">
          <div className="text-muted-foreground mb-1 text-xs">
            Gruppen des Bots (für Ankündigungen die ID als <code>WHATSAPP_GROUP</code> setzen):
          </div>
          <ul className="space-y-1">
            {groups.map((group) => (
              <li key={group.id} className="flex flex-wrap gap-x-2">
                <span className="font-semibold">{group.subject}</span>
                <code className="text-muted-foreground text-xs">{group.id}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
  );
}
