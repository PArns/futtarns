import { CalendarDays, CalendarPlus, Flame, House, Plane, TriangleAlert, Vote } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AttendancePills } from '@/components/common/attendance-pills';
import { FridayControls } from '@/components/calendar/friday-controls';
import { ChapterHeading } from '@/components/common/chapter-heading';
import { CopyButton } from '@/components/common/copy-button';
import { PageHero } from '@/components/layout/page-hero';
import { DutchFlag } from '@/components/pentecost/dutch-flag';
import { HollandCountdown } from '@/components/pentecost/holland-countdown';
import { AbsenceForm, RemoveAbsenceButton } from '@/components/profile/absence-form';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Notice } from '@/components/ui/notice';
import { answerKind } from '@/lib/attendance';
import { calendarLink } from '@/lib/auth-tokens';
import { todayIso } from '@/lib/dates';
import { getDb } from '@/lib/db';
import { formatDayShort, formatEuro, formatMonth } from '@/lib/format';
import { isHollandFriday } from '@/lib/pentecost';
import { canManageFriday, canSetHost } from '@/lib/permissions';
import { getGroupContext } from '@/lib/session';
import { loadCalendar } from '@/lib/services/fridays';
import { getDefaultHost, listAbsences, listMembers } from '@/lib/services/members';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Kalender' };

const WEEKS = 16;

export default async function CalendarPage() {
  const { viewer, currentFriday, now } = await getGroupContext();
  const db = await getDb();
  const [entries, members, defaultHost, myAbsences] = await Promise.all([
    loadCalendar(db, currentFriday, WEEKS, new Date(now)),
    listMembers(db),
    getDefaultHost(db),
    listAbsences(db, viewer.id, todayIso()),
  ]);
  // Only the Stammtruppe hosts.
  const active = members.filter((member) => member.active && member.core);
  const feed = viewer.calendarToken ? calendarLink(viewer.calendarToken) : null;

  const months = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = entry.date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), entry]);
  }

  return (
    <>
      <PageHero icon={CalendarDays} kicker="Was steht an" title="Die nächsten Freitage">
        <p className="hero-item text-muted-foreground mt-3 max-w-2xl text-balance">
          {defaultHost ? `Normalerweise ist ${defaultHost.name} Gastgeber. ` : ''}
          Vertretungen und Absagen stehen hier, und wer abwesend ist, wird an diesen Tagen
          automatisch nicht eingeplant.
        </p>
        {feed && (
          <div className="hero-item mt-5 flex flex-wrap gap-2">
            <a href={feed.replace(/^https?:/, 'webcal:')} className={buttonVariants()}>
              <CalendarPlus /> Kalender abonnieren
            </a>
            <CopyButton text={feed} label="Link kopieren" />
          </div>
        )}
      </PageHero>

      <div className="mx-auto max-w-5xl space-y-12 px-4">
        <GlassCard id="pfingsten" variant="tile" className="scroll-mt-20 p-4 sm:p-5">
          <HollandCountdown serverNow={now} />
        </GlassCard>

        {[...months.entries()].map(([key, monthEntries]) => (
          <section key={key}>
            <ChapterHeading
              icon={CalendarDays}
              kicker="Freitage im"
              title={formatMonth(monthEntries[0]!.date)}
              className="mb-4"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {monthEntries.map((entry) => {
                const manage = canManageFriday(viewer, entry.host?.id ?? null);
                const pickHost = canSetHost(viewer, entry.host?.id ?? null);
                // An absent host already reads „Du bist weg“ in the notice above the picker.
                const meAway =
                  entry.absentMemberIds.includes(viewer.id) && entry.host?.id !== viewer.id;
                const needsSubstitute = entry.hostAbsent && !entry.cancelled;
                const holland = isHollandFriday(entry.date);
                return (
                  <GlassCard
                    key={entry.date}
                    variant="tile"
                    className={cn(
                      'flex flex-col gap-3 p-4',
                      entry.date === currentFriday && 'border-primary/60 ring-primary/30 ring-2'
                    )}
                  >
                    <Link
                      href={entry.date === currentFriday ? '/' : `/freitag/${entry.date}`}
                      className="group flex items-start gap-3"
                    >
                      <div className="border-primary/30 flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl border bg-[linear-gradient(150deg,color-mix(in_oklab,var(--color-primary)_22%,transparent)_0%,color-mix(in_oklab,var(--color-primary)_6%,transparent)_100%)]">
                        <span className="text-xl leading-none font-black tabular-nums">
                          {Number(entry.date.slice(8))}
                        </span>
                        <span className="text-primary text-[10px] font-bold tracking-wider uppercase">
                          {formatDayShort(entry.date).split(' ')[1]?.replace('.', '')}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            'group-hover:text-primary truncate font-bold transition-colors',
                            entry.cancelled && 'text-error'
                          )}
                        >
                          {entry.cancelled
                            ? 'Fällt aus'
                            : entry.mode === 'flat'
                              ? (entry.flatTitle ?? 'Pauschale')
                              : (entry.restaurant?.name ?? 'Restaurant noch offen')}
                        </div>
                        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                          {entry.host && (
                            <span className="inline-flex items-center gap-1">
                              <House className="text-primary size-3" />
                              {entry.host.name}
                            </span>
                          )}
                          {entry.mode === 'flat' && entry.flatPriceCents && (
                            <span className="inline-flex items-center gap-1">
                              <Flame className="text-primary size-3" />
                              {formatEuro(entry.flatPriceCents)} p. P.
                            </span>
                          )}
                          {entry.voting && (
                            <span className="text-primary inline-flex items-center gap-1 font-semibold">
                              <Vote className="size-3" />
                              Restaurantwahl läuft
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>

                    {needsSubstitute && entry.host && (
                      <Notice className="flex items-start gap-2">
                        <TriangleAlert className="text-warning" />
                        <span>
                          <strong className="text-warning block">
                            {entry.host.id === viewer.id ? 'Du bist' : `${entry.host.name} ist`} weg
                            – wer übernimmt?
                          </strong>
                          <span className="text-muted-foreground">
                            {manage
                              ? 'Unten eine Vertretung wählen oder den Freitag absagen.'
                              : pickHost
                                ? 'Unten eine Vertretung wählen.'
                                : `${entry.host.name} oder ein Admin trägt die Vertretung ein.`}
                          </span>
                        </span>
                      </Notice>
                    )}
                    {(entry.date === currentFriday ||
                      (!entry.hostIsDefault && !entry.cancelled) ||
                      meAway ||
                      holland) && (
                      <div className="flex flex-wrap gap-1.5">
                        {entry.date === currentFriday && (
                          <Badge variant="primary">Diese Woche</Badge>
                        )}
                        {holland && (
                          <Badge variant="soft">
                            <DutchFlag className="h-2.5 w-[15px]" /> Pfingsten in Holland
                          </Badge>
                        )}
                        {!entry.hostIsDefault && !entry.cancelled && (
                          <Badge variant="soft">Vertretung</Badge>
                        )}
                        {meAway && (
                          <Badge variant="softWarning">
                            <Plane /> Du bist weg
                          </Badge>
                        )}
                      </div>
                    )}
                    {entry.cancelled && entry.cancelReason && (
                      <p className="text-muted-foreground text-xs">{entry.cancelReason}</p>
                    )}
                    {!entry.cancelled &&
                      entry.people.length > 0 &&
                      // Nobody answered or is away yet: one line instead of everyone's name.
                      (entry.mode !== 'flat' &&
                      entry.people.every((person) => answerKind(person) === 'silent') ? (
                        <p className="text-muted-foreground text-xs">
                          Alle {entry.people.length} dabei, keiner hat abgesagt.
                        </p>
                      ) : (
                        <AttendancePills people={entry.people} flat={entry.mode === 'flat'} />
                      ))}
                    {pickHost && (
                      <div className="border-border/50 mt-auto border-t pt-3">
                        <FridayControls
                          date={entry.date}
                          hostId={entry.host?.id ?? null}
                          hostIsDefault={entry.hostIsDefault}
                          defaultHostName={defaultHost?.name ?? null}
                          members={active.map(({ id, name }) => ({ id, name }))}
                          cancelled={entry.cancelled}
                          needsSubstitute={needsSubstitute}
                          canCancel={manage}
                        />
                      </div>
                    )}
                  </GlassCard>
                );
              })}
            </div>
          </section>
        ))}

        <section id="abwesend">
          <ChapterHeading
            icon={Plane}
            kicker="Urlaubsmodus"
            title="Wann bist du weg?"
            hint="An diesen Tagen bist du automatisch raus und bekommst kein Standardgericht."
          />
          <GlassCard variant="tile" className="space-y-4 p-5">
            <AbsenceForm defaultFrom={currentFriday} />
            {myAbsences.length > 0 && (
              <ul className="divide-border/50 divide-y">
                {myAbsences.map((absence) => (
                  <li key={absence.id} className="flex items-center gap-3 py-2 text-sm">
                    <Plane className="text-primary size-4" />
                    <span className="flex-1">
                      {formatDayShort(absence.fromDate)} – {formatDayShort(absence.toDate)}
                      {absence.note && (
                        <span className="text-muted-foreground"> · {absence.note}</span>
                      )}
                    </span>
                    <RemoveAbsenceButton id={absence.id} />
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </section>
      </div>
    </>
  );
}
