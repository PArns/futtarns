import { Badge } from '@/components/ui/badge';
import type { CalendarPerson } from '@/lib/services/fridays';

// Who said yes first, then who counts by silence, then the rest.
const ORDER = (person: CalendarPerson) =>
  person.status === 'out' ? 3 : person.status === 'nofood' ? 2 : person.answered ? 0 : 1;

function variantFor(person: CalendarPerson) {
  if (person.status === 'out') return 'softError';
  if (person.status === 'nofood') return 'softWarning';
  return person.answered ? 'softSuccess' : 'outline';
}

/**
 * Who comes to a Friday, one pill per person: green said yes, grey has not answered and
 * counts by the Friday's rule (silence means in), yellow comes without food, red is out.
 */
export function WhoComes({ people }: { people: CalendarPerson[] }) {
  const coming = people.filter((person) => person.status !== 'out').length;
  const sorted = [...people].sort((a, b) => ORDER(a) - ORDER(b));
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs">
        <span className="text-foreground font-semibold">{coming} dabei</span>
        {people.length > coming && ` · ${people.length - coming} raus`}
      </p>
      <div className="flex flex-wrap gap-1">
        {sorted.map((person) => (
          <Badge
            key={person.id}
            variant={variantFor(person)}
            className={variantFor(person) === 'outline' ? 'text-muted-foreground' : undefined}
            title={
              person.status === 'out'
                ? 'raus'
                : person.status === 'nofood'
                  ? 'kommt ohne Essen'
                  : person.answered
                    ? 'hat zugesagt'
                    : 'noch keine Antwort'
            }
          >
            {person.name}
          </Badge>
        ))}
      </div>
    </div>
  );
}
