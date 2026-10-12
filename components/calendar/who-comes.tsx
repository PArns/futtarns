import { CircleCheck, CircleSlash, CircleX } from 'lucide-react';
import type { CalendarPerson } from '@/lib/services/fridays';
import { cn } from '@/lib/utils';

const ROWS = [
  { status: 'in', label: 'Dabei', icon: CircleCheck, tone: 'text-success' },
  { status: 'nofood', label: 'Ohne Essen', icon: CircleSlash, tone: 'text-warning' },
  { status: 'out', label: 'Raus', icon: CircleX, tone: 'text-muted-foreground' },
] as const;

/**
 * Who comes to a Friday, by name. Names without an answer are dimmed: they count by the
 * Friday's rule (silence means in), not because they said so.
 */
export function WhoComes({ people }: { people: CalendarPerson[] }) {
  const silent = people.filter((person) => !person.answered && person.status !== 'out').length;
  return (
    <div className="space-y-1 text-xs">
      {ROWS.map(({ status, label, icon: Icon, tone }) => {
        const group = people.filter((person) => person.status === status);
        if (group.length === 0) return null;
        return (
          <p key={status} className="flex items-start gap-1.5">
            <Icon className={cn('mt-px size-3.5 shrink-0', tone)} />
            <span>
              <span className="font-semibold">
                {label} {group.length}:
              </span>{' '}
              {group.map((person, index) => (
                <span key={person.id} className={cn(!person.answered && 'text-muted-foreground')}>
                  {person.name}
                  {index < group.length - 1 && ', '}
                </span>
              ))}
            </span>
          </p>
        );
      })}
      {silent > 0 && (
        <p className="text-muted-foreground">
          Grau: noch keine Antwort ({silent}), zählt trotzdem mit.
        </p>
      )}
    </div>
  );
}
