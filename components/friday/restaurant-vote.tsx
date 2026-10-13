'use client';

import { Crown, ExternalLink, Vote as VoteIcon } from 'lucide-react';
import { voteAction } from '@/app/actions';
import { Avatar } from '@/components/ui/avatar';
import { Button, buttonVariants } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Pill } from '@/components/ui/pill';
import { formatCountdown } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { useNow } from '@/lib/hooks/use-now';
import { cn } from '@/lib/utils';

export type BallotOption = {
  id: number;
  letter: string;
  name: string;
  cuisine: string | null;
  lieferandoUrl: string | null;
  delivers: boolean;
  /** What the Friday orders from if the vote changes nothing. */
  current: boolean;
  voters: { id: number; name: string }[];
};

/**
 * The restaurant vote: every option with who wants it, and the viewer's own pick, which
 * they can change or take back until Thursday midnight. The most votes win; without votes
 * or on a tie it stays as it is.
 */
export function RestaurantVote({
  date,
  options,
  myVote,
  closesAt,
  serverNow,
}: {
  date: string;
  options: BallotOption[];
  myVote: number | null;
  closesAt: number;
  serverNow: number;
}) {
  const now = useNow(serverNow);
  const { pending, execute } = useAction();
  const most = Math.max(0, ...options.map((option) => option.voters.length));
  const open = now < closesAt;

  return (
    <GlassCard variant="tile" className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          Antworten geht auch per WhatsApp mit dem Buchstaben.
        </p>
        <Pill tone={open ? 'primary' : 'muted'}>
          {open ? `Wahllokal schließt ${formatCountdown(closesAt - now)}` : 'Wahllokal geschlossen'}
        </Pill>
      </div>
      <ul className="divide-border/50 divide-y">
        {options.map((option) => {
          const mine = option.id === myVote;
          const leading = most > 0 && option.voters.length === most;
          return (
            <li key={option.id} className="flex items-center gap-3 py-3">
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-extrabold',
                  mine ? 'border-primary bg-primary/15 text-primary' : 'border-border'
                )}
              >
                {option.letter}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-semibold">{option.name}</span>
                  {option.current && (
                    <span className="text-warning inline-flex items-center gap-1 text-xs font-semibold">
                      <Crown className="size-3.5" /> bisher
                    </span>
                  )}
                  {!option.delivers && (
                    <span className="text-muted-foreground text-xs">nur abholen</span>
                  )}
                </div>
                <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                  {option.cuisine && <span>{option.cuisine}</span>}
                  {option.voters.length > 0 && (
                    <span
                      className={cn(
                        'inline-flex flex-wrap items-center gap-1',
                        leading && 'text-foreground font-semibold'
                      )}
                    >
                      {option.cuisine && <span aria-hidden>·</span>}
                      {option.voters.length} {option.voters.length === 1 ? 'Stimme' : 'Stimmen'}:
                      <span className="flex -space-x-1.5">
                        {option.voters.slice(0, 5).map((voter) => (
                          <Avatar
                            key={voter.id}
                            name={voter.name}
                            id={voter.id}
                            className="ring-background size-5 text-[9px] ring-2"
                          />
                        ))}
                      </span>
                      {option.voters.map((voter) => voter.name).join(', ')}
                    </span>
                  )}
                </div>
              </div>
              {option.lieferandoUrl && (
                <a
                  href={option.lieferandoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
                  aria-label={`${option.name} bei Lieferando ansehen`}
                >
                  <ExternalLink />
                </a>
              )}
              <Button
                variant={mine ? 'default' : 'outline'}
                size="sm"
                disabled={pending || !open}
                onClick={() => execute(() => voteAction(date, mine ? null : option.id))}
                aria-pressed={mine}
              >
                <VoteIcon className="max-sm:hidden" /> {mine ? 'Meine Wahl' : 'Wählen'}
              </Button>
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}
