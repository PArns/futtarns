import { Bot, CircleCheck } from 'lucide-react';
import { AssistantKeyForm } from '@/components/people/assistant-key-form';
import { GlassCard } from '@/components/ui/glass-card';
import { ASSISTANT_MODEL, DAILY_LIMIT } from '@/lib/assistant';
import { getDb } from '@/lib/db';
import { assistantKeyInfo } from '@/lib/services/assistant';

/**
 * For admins: the Claude API key the bot reads messages with. Once saved it only shows its
 * last characters; it can be replaced or deleted, never read back.
 */
export async function AssistantCard() {
  const key = await assistantKeyInfo(await getDb());
  return (
    <GlassCard variant="tile" className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Bot className="text-primary size-5" />
        <div className="flex-1 font-bold">Claude im Bot</div>
        {key.source ? (
          <span className="text-success inline-flex items-center gap-1 text-sm font-semibold">
            <CircleCheck className="size-4" /> an
            <span className="text-muted-foreground font-normal">
              Key …{key.ending}
              {key.source === 'env' && ' (aus ANTHROPIC_API_KEY)'}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground text-sm font-semibold">aus</span>
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        Versteht der Bot eine Nachricht nicht, liest Claude ({ASSISTANT_MODEL}) sie: zusagen,
        Restaurant wählen, bestellen, erklären, plaudern, aber nur rund um den Freitag. Fremde
        Nummern bekommen weiter gar nichts. Höchstens {DAILY_LIMIT} Nachrichten pro Person und Tag.
      </p>
      <AssistantKeyForm stored={key.source === 'app'} />
    </GlassCard>
  );
}
