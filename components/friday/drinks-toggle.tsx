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
        <span className="block text-sm font-semibold">Getränke {formatEuro(feeCents)}</span>
        {!compact && (
          <span className="text-muted-foreground block text-xs">
            {on ? 'Freiwillig, für Cola und Co. vom Gastgeber' : 'Abgewählt – trinkst nichts mit'}
          </span>
        )}
      </span>
      <SwitchKnob on={on} />
    </button>
  );
}
