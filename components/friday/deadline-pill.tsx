'use client';

import { Pill, PillDot } from '@/components/ui/pill';
import { formatMinutesLeft } from '@/lib/format';
import { useNow } from '@/lib/hooks/use-now';

/** Where ordering stands; in the last hour it counts down to the second. */
export function DeadlinePill({
  deadline,
  deadlineLabel,
  serverNow,
  locked,
  settled,
  cancelled,
  flat,
}: {
  deadline: number;
  deadlineLabel: string;
  serverNow: number;
  locked: boolean;
  settled: boolean;
  cancelled: boolean;
  flat: boolean;
}) {
  const now = useNow(serverNow);
  if (cancelled) {
    return (
      <Pill size="label" tone="muted">
        Fällt aus
      </Pill>
    );
  }
  if (settled) {
    return (
      <Pill size="label" tone="primary">
        Abgerechnet
      </Pill>
    );
  }
  if (locked || now >= deadline) {
    return (
      <Pill size="label" tone="warning">
        <PillDot />
        {flat ? 'Anmeldeschluss vorbei' : 'Bestellschluss vorbei'}
      </Pill>
    );
  }
  const left = deadline - now;
  return (
    <Pill size="label" tone="success">
      <PillDot />
      {left < 3_600_000
        ? `Nur noch ${formatMinutesLeft(left)}`
        : `${flat ? 'Anmeldung' : 'Bestellung'} offen bis ${deadlineLabel}`}
    </Pill>
  );
}
