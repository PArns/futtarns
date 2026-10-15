'use client';

import { Pill, PillDot } from '@/components/ui/pill';
import { formatMinutesLeft } from '@/lib/format';
import { useNow } from '@/lib/hooks/use-now';

/**
 * Where ordering stands once it matters: in the last hour a countdown, then closed or
 * settled. Before that the time line above already says until when.
 */
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
  if (left >= 3_600_000) return null;
  return (
    <Pill size="label" tone="success">
      <PillDot />
      Nur noch {formatMinutesLeft(left)} bis {flat ? 'Anmeldeschluss' : 'Bestellschluss'} um{' '}
      {deadlineLabel}
    </Pill>
  );
}
