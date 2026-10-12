'use client';

import { CircleX, Coffee, UtensilsCrossed } from 'lucide-react';
import { setAnswerAction } from '@/app/actions';
import type { AttendanceStatus } from '@/lib/db/schema';
import { useAction } from '@/lib/hooks/use-action';
import { cn } from '@/lib/utils';

const OPTIONS: { status: AttendanceStatus; label: string; icon: typeof Coffee; tone: string }[] = [
  {
    status: 'in',
    label: 'Bin dabei',
    icon: UtensilsCrossed,
    tone: 'bg-badge-success text-white border-success/40',
  },
  {
    status: 'nofood',
    label: 'Komme, ess nix',
    icon: Coffee,
    tone: 'bg-badge-primary text-white border-primary/40',
  },
  {
    status: 'out',
    label: 'Bin raus',
    icon: CircleX,
    tone: 'bg-badge-muted text-white border-border',
  },
];

/** The three answers to "are you coming", as one segmented control. */
export function AnswerControl({
  date,
  memberId,
  status,
  answered,
  disabled,
  hasItems,
}: {
  date: string;
  memberId: number;
  status: AttendanceStatus;
  /** False while the status only comes from not having answered; tapping it confirms. */
  answered: boolean;
  disabled?: boolean;
  hasItems: boolean;
}) {
  const { pending, execute } = useAction();

  function choose(next: AttendanceStatus) {
    if (next === status && answered) return;
    if (
      next !== 'in' &&
      hasItems &&
      !window.confirm('Deine Bestellung wird dabei gelöscht. Weiter?')
    )
      return;
    execute(() => setAnswerAction({ date, memberId, status: next }));
  }

  return (
    <div
      role="radiogroup"
      aria-label="Bist du dabei?"
      className={cn(
        'border-border/60 bg-background/40 grid grid-cols-3 gap-1 rounded-2xl border p-1',
        pending && 'opacity-70'
      )}
    >
      {OPTIONS.map(({ status: value, label, icon: Icon, tone }) => {
        const active = value === status;
        const tentative = active && !answered;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled || pending}
            onClick={() => choose(value)}
            className={cn(
              'flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold transition-colors sm:flex-row sm:gap-2 sm:text-sm',
              tentative
                ? 'border-success/50 text-foreground border-dashed'
                : active
                  ? tone
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              'disabled:cursor-not-allowed'
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
