'use client';

import { BellRing, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { Pill } from '@/components/ui/pill';
import { formatCountdown } from '@/lib/format';
import { useNow } from '@/lib/hooks/use-now';

export type UpcomingMessage = {
  at: number;
  /** `Fr., 10:00` */
  when: string;
  kind: string;
  recipients: string[];
};

const NAMES_SHOWN = 4;

/** For the host: which WhatsApp messages this Friday still sends, to whom, and when. */
export function UpcomingMessages({
  messages,
  serverNow,
  whatsappDown = false,
}: {
  messages: UpcomingMessage[];
  serverNow: number;
  /** The bot is not linked to WhatsApp: what is due waits, retried every minute. */
  whatsappDown?: boolean;
}) {
  const now = useNow(serverNow);
  const upcoming = messages.filter((message) => message.at > now);
  return (
    <GlassCard variant="tile" className="space-y-3 p-5">
      <h3 className="flex items-center gap-2 font-bold">
        <BellRing className="text-primary size-4" /> Nachrichten, die noch rausgehen
      </h3>
      {whatsappDown && (
        <p className="border-warning/40 bg-warning/10 text-warning flex items-start gap-2 rounded-xl border p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            WhatsApp ist gerade nicht verbunden. Was fällig ist, bleibt liegen und geht raus, sobald
            der Bot wieder verbunden ist. Ein Admin kann ihn unter{' '}
            <Link href="/leute#whatsapp" className="font-semibold underline">
              Leute
            </Link>{' '}
            neu verbinden.
          </span>
        </p>
      )}
      {upcoming.length === 0 ? (
        <p className="text-muted-foreground text-sm">Für diesen Freitag steht nichts mehr an.</p>
      ) : (
        <ul className="divide-border/50 divide-y text-sm">
          {upcoming.map((message) => (
            <li key={`${message.at}-${message.kind}`} className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{message.kind}</div>
                <div className="text-muted-foreground text-xs">
                  {message.when} · an {message.recipients.slice(0, NAMES_SHOWN).join(', ')}
                  {message.recipients.length > NAMES_SHOWN &&
                    ` +${message.recipients.length - NAMES_SHOWN}`}
                </div>
              </div>
              <Pill tone="primary">{formatCountdown(message.at - now)}</Pill>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">
        So wie es gerade steht. Wer antwortet oder bestellt, fällt aus späteren Erinnerungen heraus.
      </p>
    </GlassCard>
  );
}
