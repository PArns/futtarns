'use client';

import { setAnswerAction } from '@/app/actions';
import { Select } from '@/components/ui/input';
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
    <Select
      variant="sm"
      containerClassName="shrink-0"
      aria-label="Antwort ändern"
      value={status}
      disabled={pending}
      onChange={(event) =>
        execute(() =>
          setAnswerAction({ date, memberId, status: event.target.value as AttendanceStatus })
        )
      }
      className={cn('w-auto', pending && 'opacity-60')}
    >
      {(Object.keys(LABELS) as AttendanceStatus[]).map((value) => (
        <option key={value} value={value}>
          {LABELS[value]}
        </option>
      ))}
    </Select>
  );
}
