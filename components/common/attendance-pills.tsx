import { Badge } from '@/components/ui/badge';
import { answerKind, attendanceSummary, type AttendancePerson } from '@/lib/attendance';
import { cn } from '@/lib/utils';

const MEANING = {
  yes: { variant: 'softSuccess', title: 'hat zugesagt', rank: 0, muted: false },
  silent: {
    variant: 'outline',
    title: 'noch keine Antwort, zählt als dabei',
    rank: 1,
    muted: true,
  },
  nofood: { variant: 'softWarning', title: 'kommt ohne Essen', rank: 2, muted: false },
  waiting: { variant: 'outline', title: 'noch keine Antwort', rank: 3, muted: true },
  out: { variant: 'outline', title: 'raus', rank: 4, muted: true },
} as const;

function meaningOf(person: Pick<AttendancePerson, 'status' | 'answered' | 'waiting'>) {
  return MEANING[answerKind(person)];
}

/**
 * One person's answer for a Friday as a pill: green said yes, grey has not answered (and
 * counts as in where silence means in), yellow comes without food, struck through is out.
 */
export function AttendancePill({
  person,
  label = person.name,
}: {
  person: Pick<AttendancePerson, 'name' | 'status' | 'answered' | 'waiting'>;
  label?: string;
}) {
  const meaning = meaningOf(person);
  return (
    <Badge
      variant={meaning.variant}
      className={cn(
        meaning.muted && 'text-muted-foreground',
        answerKind(person) === 'out' && 'line-through opacity-70'
      )}
      title={`${person.name}: ${meaning.title}`}
    >
      {label}
    </Badge>
  );
}

/** Everyone's answer for a Friday as pills, yeses first, with a count above. */
export function AttendancePills({
  people,
  flat = false,
}: {
  people: AttendancePerson[];
  /** A flat-price evening counts heads, not eaters. */
  flat?: boolean;
}) {
  const sorted = [...people].sort((a, b) => meaningOf(a).rank - meaningOf(b).rank);
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs">{attendanceSummary(people, flat)}</p>
      <div className="flex flex-wrap gap-1">
        {sorted.map((person) => (
          <AttendancePill key={person.id} person={person} />
        ))}
      </div>
    </div>
  );
}
