import { asc, eq } from 'drizzle-orm';
import { MessageCircle, UserPlus, Users, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AttendancePill } from '@/components/common/attendance-pills';
import { ChapterHeading } from '@/components/common/chapter-heading';
import { PageHero } from '@/components/layout/page-hero';
import { CreateMemberForm } from '@/components/people/create-member-form';
import { EditMemberForm } from '@/components/people/edit-member-form';
import { MemberActions } from '@/components/people/member-actions';
import { WhatsAppCard } from '@/components/people/whatsapp-card';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { GlassCard } from '@/components/ui/glass-card';
import { getDb } from '@/lib/db';
import { members, type Member } from '@/lib/db/schema';
import { formatDayShort, formatEuro } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import { getGroupContext } from '@/lib/session';
import { answerKind, type AnswerKind } from '@/lib/attendance';
import { loadCalendar, openBalances } from '@/lib/services/fridays';
import { listMembers } from '@/lib/services/members';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Leute' };

const ANSWER_LABEL: Record<AnswerKind, string> = {
  yes: 'dabei',
  silent: 'keine Antwort',
  nofood: 'ohne Essen',
  out: 'raus',
};

// The client component gets only what it shows: a full row would put calendar tokens and
// login-link hashes into the page source.
function forActions({
  id,
  name,
  phone,
  isAdmin,
  isDefaultHost,
  assignsHosts,
  active,
  kind,
}: Member) {
  return { id, name, phone, isAdmin, isDefaultHost, assignsHosts, active, kind };
}

export default async function PeoplePage() {
  const { viewer, canManage, currentFriday } = await getGroupContext();
  if (!canManage) notFound();
  const db = await getDb();
  const [people, guests, balances, [friday]] = await Promise.all([
    listMembers(db),
    db.select().from(members).where(eq(members.kind, 'guest')).orderBy(asc(members.name)),
    openBalances(db, currentFriday, new Date()),
    loadCalendar(db, currentFriday, 1),
  ]);
  const thisFriday = new Map(friday?.people.map((person) => [person.id, person]));

  return (
    <>
      <PageHero icon={Users} kicker="Die Bande" title="Leute">
        <p className="hero-item text-muted-foreground mt-3 max-w-2xl">
          Wer hier steht, meldet sich mit seiner Handynummer an und zählt freitags als dabei,
          solange er nicht absagt. Gäste brauchen kein Konto, sie werden am Freitag direkt
          eingetragen.
        </p>
      </PageHero>

      <div className="mx-auto max-w-5xl space-y-12 px-4">
        {viewer.isAdmin && (
          <section id="whatsapp">
            <ChapterHeading icon={MessageCircle} kicker="Der Bote" title="WhatsApp" />
            <WhatsAppCard />
          </section>
        )}

        <section>
          <ChapterHeading icon={UserPlus} kicker="Neuzugang" title="Jemanden dazuholen" />
          <GlassCard variant="tile" className="p-5">
            <CreateMemberForm canGrantAdmin={viewer.isAdmin} />
          </GlassCard>
        </section>

        {balances.length > 0 && (
          <section>
            <ChapterHeading
              icon={Wallet}
              kicker="Offene Deckel"
              title="Offene Beträge"
              hint="Von abgerechneten Freitagen der letzten acht Wochen. Positiv: muss noch zahlen, negativ: bekommt Geld zurück."
            />
            <GlassCard variant="tile" className="p-5">
              <ul className="divide-border/50 divide-y text-sm">
                {balances.map((balance) => (
                  <li
                    key={`${balance.fridayDate}-${balance.member.id}-${balance.debt.what}`}
                    className="flex items-center gap-3 py-2"
                  >
                    <Avatar
                      name={balance.member.name}
                      id={balance.member.id}
                      className="size-7 text-[10px]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{balance.member.name}</span>
                      <Link
                        href={`/freitag/${balance.fridayDate}`}
                        className="text-muted-foreground hover:text-primary block text-xs"
                      >
                        {formatDayShort(balance.fridayDate)} · {balance.title}
                        {balance.payee && ` · an ${balance.payee.name}`}
                      </Link>
                    </span>
                    <span
                      className={cn(
                        'font-bold tabular-nums',
                        balance.debt.openCents > 0 ? 'text-warning' : 'text-primary'
                      )}
                    >
                      {formatEuro(balance.debt.openCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </GlassCard>
          </section>
        )}

        <section>
          <ChapterHeading
            icon={Users}
            kicker="Stammtisch"
            title={`${people.filter((p) => p.active).length} in der Runde`}
            hint={
              viewer.isAdmin
                ? 'Die Rolle „Gastgeber“ darf für einzelne Freitage einen anderen Gastgeber eintragen.'
                : undefined
            }
          />
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
            {people.map((member) => (
              <GlassCard
                key={member.id}
                variant="tile"
                className={member.active ? 'p-4' : 'p-4 opacity-60'}
              >
                <div className="mb-3 flex items-center gap-3">
                  <Avatar name={member.name} id={member.id} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <span className="truncate">{member.name}</span>
                    </div>
                    <div className="text-muted-foreground truncate text-xs">
                      {[
                        member.phone && formatPhone(member.phone),
                        member.paypalMe && `PayPal: ${member.paypalMe}`,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'keine Angaben'}
                    </div>
                  </div>
                  {!member.phone && <Badge variant="softWarning">ohne Nummer</Badge>}
                </div>
                <div className="mb-3 flex flex-wrap gap-1">
                  {thisFriday.has(member.id) && (
                    <AttendancePill
                      person={thisFriday.get(member.id)!}
                      label={`Freitag: ${ANSWER_LABEL[answerKind(thisFriday.get(member.id)!)]}`}
                    />
                  )}
                  {member.isAdmin && <Badge variant="soft">Admin</Badge>}
                  {member.isDefaultHost && <Badge variant="soft">Standard-Gastgeber</Badge>}
                  {member.assignsHosts && <Badge variant="soft">Gastgeber</Badge>}
                </div>
                {viewer.isAdmin && (
                  <details className="mb-3">
                    <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs font-semibold">
                      Name oder Nummer ändern
                    </summary>
                    <div className="mt-2">
                      <EditMemberForm id={member.id} name={member.name} phone={member.phone} />
                    </div>
                  </details>
                )}
                <MemberActions
                  member={forActions(member)}
                  isAdminViewer={viewer.isAdmin}
                  canIssueLink={viewer.isAdmin}
                />
              </GlassCard>
            ))}
          </div>
        </section>

        {guests.length > 0 && (
          <section>
            <ChapterHeading
              kicker="Zaungäste"
              title="Waren schon mal da"
              hint="Wer öfter kommt, kann ein eigenes Konto bekommen."
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {guests.map((guest) => (
                <GlassCard key={guest.id} variant="tile" className="flex flex-col gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={guest.name} id={guest.id} />
                    <span className="font-bold">{guest.name}</span>
                  </div>
                  <MemberActions
                    member={forActions(guest)}
                    isAdminViewer={viewer.isAdmin}
                    canIssueLink
                  />
                </GlassCard>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
