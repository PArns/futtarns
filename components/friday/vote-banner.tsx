'use client';

import { ChevronRight, Vote } from 'lucide-react';
import { formatCountdown } from '@/lib/format';
import { useNow } from '@/lib/hooks/use-now';

/**
 * At the top of a Friday while the group votes: the restaurant is not settled yet, how
 * long the vote runs and who leads, with a way to the ballot.
 */
export function VoteBanner({
  closesAt,
  serverNow,
  standing,
  canVote,
}: {
  closesAt: number;
  serverNow: number;
  /** Where the vote stands, such as `Vorne: Sakura Sushi mit 2 Stimmen`. */
  standing: string;
  canVote: boolean;
}) {
  const now = useNow(serverNow);
  if (now >= closesAt) return null;
  const body = (
    <>
      <span className="bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
        <Vote className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          Restaurantwahl läuft · schließt {formatCountdown(closesAt - now)}
        </span>
        <span className="text-muted-foreground block">
          {standing}. Fest steht das Restaurant erst nach der Wahl, Donnerstag um 23:59.
        </span>
      </span>
      {canVote && (
        <span className="text-primary inline-flex shrink-0 items-center gap-0.5 font-semibold max-sm:hidden">
          Abstimmen <ChevronRight className="size-4" />
        </span>
      )}
    </>
  );
  const className =
    'border-primary/40 bg-primary/10 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm';
  return canVote ? (
    <a href="#wahl" className={`${className} hover:border-primary/70 transition-colors`}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}
