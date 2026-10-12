'use client';

import { CupSoda } from 'lucide-react';
import { setDrinksAction } from '@/app/actions';
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
  compact,
}: {
  date: string;
  memberId: number;
  feeCents: number;
  on: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { pending, execute } = useAction();
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
        <span className="block text-sm font-semibold">
          Getränkepauschale {formatEuro(feeCents)}
          <span className="text-muted-foreground font-normal"> · freiwillig</span>
        </span>
        {!compact && (
          <span className="text-muted-foreground block text-xs">
            {on ? 'Für Cola und Co., die der Gastgeber für alle holt' : 'Abgewählt – kein Problem'}
          </span>
        )}
      </span>
      <span
        aria-hidden
        className={cn(
          'relative h-6 w-10 shrink-0 rounded-full border transition-colors',
          on ? 'border-primary bg-primary' : 'border-border bg-muted'
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 size-4.5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left] duration-200',
            on ? 'left-[calc(100%-1.25rem)]' : 'left-0.5'
          )}
        />
      </span>
    </button>
  );
}
