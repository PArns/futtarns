'use client';

import { useNow } from '@/lib/hooks/use-now';
import { cn } from '@/lib/utils';

function remaining(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes >= 48 * 60) return `noch ${Math.floor(minutes / (24 * 60))} Tage`;
  if (minutes >= 60) return `noch ${Math.floor(minutes / 60)} Std ${minutes % 60} Min`;
  const seconds = Math.floor(ms / 1000) % 60;
  return `noch ${minutes}:${String(seconds).padStart(2, '0')} Min`;
}

const pill =
  'inline-flex h-[30px] w-fit items-center gap-2 rounded-full border px-3.5 text-[11px] font-bold tracking-[0.14em] uppercase shadow-sm';

/** Live countdown to the deadline; the dot is static because it sits inside glass. */
export function DeadlinePill({
  deadline,
  deadlineLabel,
  serverNow,
  locked,
  settled,
  cancelled,
}: {
  deadline: number;
  deadlineLabel: string;
  serverNow: number;
  locked: boolean;
  settled: boolean;
  cancelled: boolean;
}) {
  const now = useNow(serverNow);
  if (cancelled) {
    return (
      <span className={cn(pill, 'border-border bg-muted/60 text-muted-foreground')}>Fällt aus</span>
    );
  }
  if (settled) {
    return (
      <span className={cn(pill, 'border-primary/40 bg-primary/10 text-primary')}>Abgerechnet</span>
    );
  }
  if (locked || now >= deadline) {
    return (
      <span className={cn(pill, 'border-warning/40 bg-warning/10 text-warning')}>
        <span className="bg-warning size-1.5 rounded-full" />
        Bestellschluss vorbei
      </span>
    );
  }
  return (
    <span className={cn(pill, 'border-success/40 bg-success/10 text-success tabular-nums')}>
      <span className="bg-success size-1.5 rounded-full" />
      Offen bis {deadlineLabel} · {remaining(deadline - now)}
    </span>
  );
}
