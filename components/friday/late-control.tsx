'use client';

import { Clock } from 'lucide-react';
import { setLateAction } from '@/app/actions';
import { Select } from '@/components/ui/input';
import { ARRIVAL_TIMES } from '@/lib/arrival';
import { useAction } from '@/lib/hooks/use-action';
import { cn } from '@/lib/utils';

/**
 * „Ich komm später“ under the answer, with a rough time: the host then sees whose food to
 * order later. Picking the dish still has to be done by the deadline.
 */
export function LateControl({
  date,
  memberId,
  late,
  arrivesAt,
  deadline,
  disabled,
}: {
  date: string;
  memberId: number;
  late: boolean;
  arrivesAt: string | null;
  /** `19:00`, by when the dish is still picked. */
  deadline: string;
  disabled?: boolean;
}) {
  const { pending, execute } = useAction();
  const set = (nextLate: boolean, at: string | null) =>
    execute(() => setLateAction({ date, memberId, late: nextLate, arrivesAt: at }));

  return (
    <div className={cn('flex flex-wrap items-center gap-2', pending && 'opacity-70')}>
      <button
        type="button"
        aria-pressed={late}
        disabled={disabled || pending}
        onClick={() => set(!late, late ? null : arrivesAt)}
        className={cn(
          'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed',
          late
            ? 'border-primary/50 bg-primary/15 text-primary'
            : 'border-border text-muted-foreground hover:text-foreground'
        )}
      >
        <Clock className="size-4" /> Ich komm später
      </button>
      {late && (
        <>
          <Select
            variant="sm"
            containerClassName="shrink-0"
            aria-label="Ungefähr um"
            value={arrivesAt ?? ''}
            disabled={disabled || pending}
            onChange={(event) => set(true, event.target.value || null)}
            className="w-auto"
          >
            <option value="">Uhrzeit offen</option>
            {ARRIVAL_TIMES.map((time) => (
              <option key={time} value={time}>
                gegen {time}
              </option>
            ))}
          </Select>
          <span className="text-muted-foreground text-xs">
            Such trotzdem bis {deadline} aus, dein Essen kommt dann auf die Später-Liste.
          </span>
        </>
      )}
    </div>
  );
}
