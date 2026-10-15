'use client';

import { CupSoda } from 'lucide-react';
import { setDrinksAction } from '@/app/actions';
import { SwitchKnob } from '@/components/ui/switch-knob';
import { formatEuro } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { cn } from '@/lib/utils';

/** The drinks flat fee as a switch: on by default, one tap takes it off. */
export function DrinksToggle({
  date,
  memberId,
  feeCents,
  on,
  disabled,
  size = 'full',
}: {
  date: string;
  memberId: number;
  feeCents: number;
  on: boolean;
  disabled?: boolean;
  /** `mini` is a small chip, for the host switching it for someone in the people list. */
  size?: 'full' | 'compact' | 'mini';
}) {
  const { pending, execute } = useAction();
  const compact = size === 'compact';
  if (size === 'mini') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Getränke ${formatEuro(feeCents)}`}
        disabled={disabled || pending}
        onClick={() => execute(() => setDrinksAction(date, memberId, !on))}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold tabular-nums transition-colors max-sm:h-8',
          on
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border text-muted-foreground line-through',
          pending && 'opacity-60'
        )}
      >
        <CupSoda className="size-3.5" /> {formatEuro(feeCents)}
      </button>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled || pending}
      onClick={() => execute(() => setDrinksAction(date, memberId, !on))}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border px-4 text-left transition-colors disabled:cursor-not-allowed',
        compact ? 'min-h-10 py-1.5' : 'min-h-12 py-2.5',
        on ? 'border-primary/40 bg-primary/10' : 'border-border bg-background/40',
        pending && 'opacity-60'
      )}
    >
      <CupSoda className={cn('size-5 shrink-0', on ? 'text-primary' : 'text-muted-foreground')} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Getränke {formatEuro(feeCents)}</span>
        {!compact && (
          <span className="text-muted-foreground block text-xs">
            {on
              ? 'Freiwillig, für Cola und Co. vom Gastgeber'
              : 'Diesmal abgewählt, nächste Woche wieder an'}
          </span>
        )}
      </span>
      <SwitchKnob on={on} />
    </button>
  );
}
