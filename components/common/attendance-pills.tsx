import { Badge } from '@/components/ui/badge';
import { answerKind, type AttendancePerson } from '@/lib/attendance';

const MEANING = {
  yes: { variant: 'softSuccess', title: 'hat zugesagt', rank: 0 },
  silent: { variant: 'outline', title: 'noch keine Antwort, zählt als dabei', rank: 1 },
  nofood: { variant: 'softWarning', title: 'kommt ohne Essen', rank: 2 },
  out: { variant: 'softError', title: 'raus', rank: 3 },
} as const;

function meaningOf(person: Pick<AttendancePerson, 'status' | 'answered'>) {
  return MEANING[answerKind(person)];
}

/**
 * One person's answer for a Friday as a pill: green said yes, grey has not answered and
 * counts by the Friday's rule, yellow comes without food, red is out.
 */
export function AttendancePill({
  person,
  label = person.name,
}: {
  person: Pick<AttendancePerson, 'name' | 'status' | 'answered'>;
  label?: string;
}) {
  const meaning = meaningOf(person);
  return (
    <Badge
      variant={meaning.variant}
      className={meaning.variant === 'outline' ? 'text-muted-foreground' : undefined}
      title={`${person.name}: ${meaning.title}`}
    >
      {label}
    </Badge>
  );
}

/** Everyone's answer for a Friday as pills, yeses first, with a count above. */
export function AttendancePills({ people }: { people: AttendancePerson[] }) {
  const coming = people.filter((person) => person.status !== 'out').length;
  const sorted = [...people].sort((a, b) => meaningOf(a).rank - meaningOf(b).rank);
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs">
        <span className="text-foreground font-semibold">{coming} dabei</span>
        {people.length > coming && ` · ${people.length - coming} raus`}
      </p>
      <div className="flex flex-wrap gap-1">
        {sorted.map((person) => (
          <AttendancePill key={person.id} person={person} />
        ))}
      </div>
    </div>
  );
}
