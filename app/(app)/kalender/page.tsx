import { CalendarPlus, Flame, House, Plane, TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FridayControls } from '@/components/calendar/friday-controls';
import { ChapterHeading } from '@/components/common/chapter-heading';
import { CopyButton } from '@/components/common/copy-button';
import { PageHero } from '@/components/layout/page-hero';
import { AbsenceForm, RemoveAbsenceButton } from '@/components/profile/absence-form';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { calendarLink } from '@/lib/auth-tokens';
import { todayIso } from '@/lib/dates';
import { getDb } from '@/lib/db';
import { formatDayShort, formatEuro, formatMonth } from '@/lib/format';
import { canManageFriday } from '@/lib/permissions';
import { getGroupContext } from '@/lib/session';
import { loadCalendar } from '@/lib/services/fridays';
import { getDefaultHost, listAbsences, listMembers } from '@/lib/services/members';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Kalender' };

const WEEKS = 16;

export default async function CalendarPage() {
  const { viewer, currentFriday } = await getGroupContext();
  const db = await getDb();
  const [entries, members, defaultHost, myAbsences] = await Promise.all([
    loadCalendar(db, currentFriday, WEEKS),
    listMembers(db),
    getDefaultHost(db),
    listAbsences(db, viewer.id, todayIso()),
  ]);
  const active = members.filter((member) => member.active);
  const nameOf = (id: number) => members.find((member) => member.id === id)?.name ?? '?';
  const feed = viewer.calendarToken ? calendarLink(viewer.calendarToken) : null;

  const months = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = entry.date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), entry]);
  }

  return (
    <>
      <PageHero kicker="Planung" title="Die nächsten Freitage">
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
        {[...months.entries()].map(([key, monthEntries]) => (
          <section key={key}>
            <ChapterHeading
              kicker="Monat"
              title={formatMonth(monthEntries[0]!.date)}
              className="mb-4"
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {monthEntries.map((entry) => {
                const manage = canManageFriday(viewer, entry.host?.id ?? null);
                const meAway = entry.absentMemberIds.includes(viewer.id);
                const away = entry.absentMemberIds.filter((id) => id !== entry.host?.id);
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
                            entry.cancelled && 'line-through opacity-60'
                          )}
                        >
                          {entry.mode === 'flat'
                            ? (entry.flatTitle ?? 'Pauschale')
                            : (entry.restaurant?.name ??
                              (entry.cancelled ? 'Freitag' : 'Restaurant offen'))}
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
                        </div>
                      </div>
                    </Link>

                    <div className="flex flex-wrap gap-1.5">
                      {entry.date === currentFriday && <Badge variant="primary">Diese Woche</Badge>}
                      {entry.cancelled && <Badge variant="error">Fällt aus</Badge>}
                      {!entry.hostIsDefault && !entry.cancelled && (
                        <Badge variant="soft">Vertretung</Badge>
                      )}
                      {entry.hostAbsent && !entry.cancelled && (
                        <Badge variant="softWarning">
                          <TriangleAlert /> Gastgeber weg
                        </Badge>
                      )}
                      {meAway && (
                        <Badge variant="softWarning">
                          <Plane /> Du bist weg
                        </Badge>
                      )}
                    </div>
                    {entry.cancelled && entry.cancelReason && (
                      <p className="text-muted-foreground -mt-1 text-xs">{entry.cancelReason}</p>
                    )}
                    {away.length > 0 && !entry.cancelled && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground text-xs">Weg:</span>
                        <div className="flex -space-x-1.5">
                          {away.map((id) => (
                            <span key={id} title={nameOf(id)}>
                              <Avatar
                                name={nameOf(id)}
                                id={id}
                                className="ring-background size-6 text-[9px] ring-2"
                              />
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {manage && (
                      <div className="border-border/50 mt-auto border-t pt-3">
                        <FridayControls
                          date={entry.date}
                          hostId={entry.host?.id ?? null}
                          hostIsDefault={entry.hostIsDefault}
                          defaultHostName={defaultHost?.name ?? null}
                          members={active.map(({ id, name }) => ({ id, name }))}
                          cancelled={entry.cancelled}
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
            kicker="Du"
            title="Wann bist du weg?"
            hint="An diesen Tagen giltst du als abgemeldet und bekommst kein Standardgericht."
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
