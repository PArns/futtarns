'use client';

import Link from 'next/link';
import { DutchFlag } from '@/components/pentecost/dutch-flag';
import { formatWeekdayDay } from '@/lib/format';
import { useNow } from '@/lib/hooks/use-now';
import { nextHollandTrip, timeUntil, type HollandTrip } from '@/lib/pentecost';
import { cn } from '@/lib/utils';

function tripDates(trip: HollandTrip) {
  return `${formatWeekdayDay(trip.friday)} – ${formatWeekdayDay(trip.tuesday)} ${trip.tuesday.slice(0, 4)}`;
}

/** Days until we leave for Holland, in the header on every page. */
export function HollandChip({ serverNow }: { serverNow: number }) {
  const now = useNow(serverNow);
  const trip = nextHollandTrip(new Date(now));
  const { days, hours } = timeUntil(trip, now);
  const away = now >= trip.start.getTime();
  const left = days >= 2 ? `${days} Tage` : days === 1 ? '1 Tag' : `${hours} Std.`;
  return (
    <Link
      href="/kalender#pfingsten"
      title={`Pfingsten in Holland: ${tripDates(trip)}`}
      className="border-border/60 hover:border-primary/50 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap tabular-nums transition-colors"
    >
      <DutchFlag />
      {away ? (
        <span>Holland!</span>
      ) : (
        <>
          <span className="max-[360px]:hidden sm:hidden">{days >= 1 ? `${days} T.` : left}</span>
          <span className="max-sm:hidden lg:hidden">noch {left}</span>
          <span className="max-lg:hidden">Pfingsten: noch {left}</span>
        </>
      )}
    </Link>
  );
}

/** The full countdown to the Friday we leave, ticking every second. */
export function HollandCountdown({ serverNow }: { serverNow: number }) {
  const now = useNow(serverNow);
  const trip = nextHollandTrip(new Date(now));
  const away = now >= trip.start.getTime();
  const left = timeUntil(trip, now);
  const parts = [
    { label: 'Tage', value: String(left.days) },
    { label: 'Std', value: String(left.hours).padStart(2, '0') },
    { label: 'Min', value: String(left.minutes).padStart(2, '0') },
    { label: 'Sek', value: String(left.seconds).padStart(2, '0') },
  ];

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <DutchFlag className="h-8 w-12 rounded-md" />
        <div>
          <div className="text-lg leading-tight font-extrabold tracking-tight">
            {away ? 'Wir sind in Holland!' : 'Pfingsten in Holland'}
          </div>
          <div className="text-muted-foreground text-sm">
            {away ? `Zurück am ${formatWeekdayDay(trip.tuesday)}` : tripDates(trip)}
          </div>
        </div>
      </div>
      {!away && (
        <div className="grid grid-cols-4 gap-2" aria-label="Noch bis zur Abfahrt">
          {parts.map((part) => (
            <div
              key={part.label}
              className={cn(
                'border-primary/25 bg-primary/8 flex min-w-14 flex-col items-center rounded-xl border px-2 py-1.5',
                part.label === 'Tage' && 'border-primary/40 bg-primary/15'
              )}
            >
              <span className="text-xl leading-none font-black tabular-nums">{part.value}</span>
              <span className="text-muted-foreground mt-0.5 text-[10px] font-bold tracking-wider uppercase">
                {part.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
