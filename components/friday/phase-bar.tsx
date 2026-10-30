'use client';

import { Check, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { formatCountdown } from '@/lib/format';
import { useNow } from '@/lib/hooks/use-now';
import { cn } from '@/lib/utils';

export type Phase = {
  key: string;
  /** Short, for the bar: `Wahl`, `Bestellen`. */
  label: string;
  /** Under the label: `bis 16:00`, `~20:45`. */
  time: string | null;
  /** When the phase is over; null while nothing but someone's action ends it. */
  endsAt: number | null;
  /** Rendered, such as `<Vote />`: a component cannot cross over from the server. */
  icon: ReactNode;
  /** What happens now, while it is the current phase: `Restaurantwahl läuft`. */
  title: string;
  /** Before the countdown to its end, such as `schließt` for `schließt in 1 Std.`. */
  countdown?: string;
  body?: ReactNode;
  action?: { href: string; label: string };
};

/** Whether `now` is in the last hour before `endsAt`, when a countdown turns urgent. */
function lastHour(endsAt: number | null, now: number) {
  return endsAt !== null && endsAt - now < 3_600_000;
}

/**
 * The phases of a Friday in a row, the current one lit, with what happens in it below:
 * vote, order, eat, pay. Phases end by the clock or by the host (paying); when the clock
 * moves the Friday into the next phase, the page asks the server again, which closes the
 * vote or locks the orders.
 */
export function PhaseBar({
  phases,
  serverNow,
  finished,
}: {
  phases: Phase[];
  serverNow: number;
  /** Shown instead once every phase is over, such as when everyone paid. */
  finished?: { title: string; body?: ReactNode };
}) {
  const now = useNow(serverNow);
  const router = useRouter();
  const found = phases.findIndex((phase) => phase.endsAt === null || phase.endsAt > now);
  const active = found === -1 ? phases.length : found;
  const seen = useRef(active);
  useEffect(() => {
    if (seen.current === active) return;
    seen.current = active;
    router.refresh();
  }, [active, router]);

  const current = phases[active];
  const body = current ? current.body : finished?.body;
  const panel = (
    <>
      <span className="bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-full max-sm:hidden [&_svg]:size-4.5">
        {current?.icon ?? <Check />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {current ? current.title : (finished?.title ?? 'Erledigt')}
          {current?.endsAt != null && current.endsAt > now && current.countdown && (
            <span
              className={cn(
                'font-normal tabular-nums',
                lastHour(current.endsAt, now) ? 'text-warning font-semibold' : 'text-foreground'
              )}
            >
              {' '}
              · {current.countdown} {formatCountdown(current.endsAt - now)}
            </span>
          )}
        </span>
        {body && <span className="text-muted-foreground block">{body}</span>}
      </span>
      {current?.action && (
        <span className="text-primary inline-flex shrink-0 items-center gap-0.5 font-semibold">
          <span className="max-sm:sr-only">{current.action.label}</span>
          <ChevronRight className="size-5" />
        </span>
      )}
    </>
  );
  const panelClass =
    'border-primary/40 bg-primary/10 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm';

  return (
    <div className="space-y-3">
      <ol
        className="grid text-center text-xs"
        style={{ gridTemplateColumns: `repeat(${phases.length}, minmax(0, 1fr))` }}
        aria-label="Ablauf des Freitags"
      >
        {phases.map((phase, index) => {
          const done = index < active;
          const isCurrent = index === active;
          return (
            <li
              key={phase.key}
              className="relative flex flex-col items-center gap-1"
              aria-current={isCurrent ? 'step' : undefined}
            >
              {/* The line to the previous phase, behind the dots. */}
              {index > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-3.5 right-1/2 h-0.5 w-full -translate-y-1/2',
                    done || isCurrent ? 'bg-success/60' : 'bg-border'
                  )}
                />
              )}
              <span
                className={cn(
                  'relative flex size-7 items-center justify-center rounded-full border text-[11px] font-bold tabular-nums',
                  done && 'border-success/50 bg-badge-success text-white',
                  isCurrent &&
                    'border-primary bg-primary text-primary-foreground ring-primary/30 ring-4',
                  !done && !isCurrent && 'border-border bg-background text-muted-foreground'
                )}
              >
                {done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  'font-semibold',
                  isCurrent ? 'text-primary' : done ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {phase.label}
              </span>
              {phase.time && (
                <span className="text-muted-foreground -mt-1 text-[11px] tabular-nums">
                  {phase.time}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {current?.action ? (
        <a
          href={current.action.href}
          className={cn(panelClass, 'hover:border-primary/70 transition-colors')}
        >
          {panel}
        </a>
      ) : (
        <div className={panelClass}>{panel}</div>
      )}
    </div>
  );
}
