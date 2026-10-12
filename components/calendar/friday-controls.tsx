'use client';

import { Ban, CalendarCheck } from 'lucide-react';
import { setCancelledAction, setHostAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { useAction } from '@/lib/hooks/use-action';
import { cn } from '@/lib/utils';

/** Host and cancel switches on a calendar card, for whoever runs that Friday. */
export function FridayControls({
  date,
  hostId,
  hostIsDefault,
  defaultHostName,
  members,
  cancelled,
  needsSubstitute,
}: {
  date: string;
  hostId: number | null;
  hostIsDefault: boolean;
  defaultHostName: string | null;
  members: { id: number; name: string }[];
  cancelled: boolean;
  /** The host is away; the picker asks for someone to take over. */
  needsSubstitute: boolean;
}) {
  const { pending, execute } = useAction();
  return (
    <div className={cn('flex items-center gap-2', pending && 'opacity-60')}>
      <select
        aria-label="Gastgeber"
        value={hostIsDefault ? '' : (hostId ?? '')}
        disabled={pending}
        onChange={(event) =>
          execute(() => setHostAction(date, event.target.value ? Number(event.target.value) : null))
        }
        className={cn(
          'border-border bg-background/60 dark:[&>option]:bg-popover h-8 min-w-0 flex-1 rounded-md border px-2 text-xs max-sm:h-10',
          needsSubstitute && 'border-warning/60 ring-warning/30 ring-2'
        )}
      >
        <option value="">
          {defaultHostName
            ? `${defaultHostName} (${needsSubstitute && hostIsDefault ? 'ist weg' : 'wie immer'})`
            : 'Standard'}
        </option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
      <Button
        variant={cancelled ? 'outline' : 'ghost'}
        size="sm"
        disabled={pending}
        onClick={() => {
          if (cancelled) execute(() => setCancelledAction(date, false, ''));
          else {
            const reason = window.prompt('Warum fällt der Freitag aus? (optional)');
            if (reason !== null) execute(() => setCancelledAction(date, true, reason));
          }
        }}
      >
        {cancelled ? <CalendarCheck /> : <Ban />}
        {cancelled ? 'Doch' : 'Absagen'}
      </Button>
    </div>
  );
}
