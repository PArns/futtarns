'use client';

import { Check, Clock } from 'lucide-react';
import { useNow } from '@/lib/hooks/use-now';
import { cn } from '@/lib/utils';

type Moment = { label: string; at: number; time: string };

function until(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `in ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `in ${hours} Std ${minutes % 60} Min` : `in ${hours} Std`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'morgen' : `in ${days} Tagen`;
}

/**
 * The evening's times with how long until each: far ahead only the first one says it,
 * on the day every coming one does, and what is past gets a tick.
 */
export function TimeLine({ moments, serverNow }: { moments: Moment[]; serverNow: number }) {
  const now = useNow(serverNow);
  const firstAhead = moments.findIndex((moment) => moment.at > now);
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Clock className="text-primary size-3.5 shrink-0" />
      {moments.map((moment, index) => {
        const past = moment.at <= now;
        const left = moment.at - now;
        const showLeft = !past && (left < 86_400_000 || index === firstAhead);
        return (
          <span
            key={moment.label}
            className={cn('inline-flex items-center gap-1 whitespace-nowrap', past && 'opacity-60')}
          >
            {past && <Check className="text-success size-3.5" />}
            {moment.label} {moment.time}
            {showLeft && (
              <span className="text-foreground font-semibold tabular-nums">({until(left)})</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
