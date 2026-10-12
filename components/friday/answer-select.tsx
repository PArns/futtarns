'use client';

import { setAnswerAction } from '@/app/actions';
import type { AttendanceStatus } from '@/lib/db/schema';
import { useAction } from '@/lib/hooks/use-action';
import { cn } from '@/lib/utils';

const LABELS: Record<AttendanceStatus, string> = { in: 'Dabei', nofood: 'Ohne Essen', out: 'Raus' };

/** Compact answer switch the host uses for someone else. */
export function AnswerSelect({
  date,
  memberId,
  status,
}: {
  date: string;
  memberId: number;
  status: AttendanceStatus;
}) {
  const { pending, execute } = useAction();
  return (
    <select
      aria-label="Antwort ändern"
      value={status}
      disabled={pending}
      onChange={(event) =>
        execute(() =>
          setAnswerAction({ date, memberId, status: event.target.value as AttendanceStatus })
        )
      }
      className={cn(
        'border-border bg-background/60 dark:[&>option]:bg-popover h-7 rounded-full border px-2 text-xs font-semibold max-sm:h-9',
        pending && 'opacity-60'
      )}
    >
      {(Object.keys(LABELS) as AttendanceStatus[]).map((value) => (
        <option key={value} value={value}>
          {LABELS[value]}
        </option>
      ))}
    </select>
  );
}
