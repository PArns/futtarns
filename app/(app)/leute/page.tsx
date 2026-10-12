import { House, ShieldCheck, UserPlus, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChapterHeading } from '@/components/common/chapter-heading';
import { PageHero } from '@/components/layout/page-hero';
import { CreateMemberForm } from '@/components/people/create-member-form';
import { MemberActions } from '@/components/people/member-actions';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { GlassCard } from '@/components/ui/glass-card';
import { getDb } from '@/lib/db';
import { members } from '@/lib/db/schema';
import { getGroupContext } from '@/lib/session';
import { listMembers } from '@/lib/services/members';
import { asc, eq } from 'drizzle-orm';

export const metadata: Metadata = { title: 'Leute' };

export default async function PeoplePage() {
  const { viewer, canManage } = await getGroupContext();
  if (!canManage) notFound();
  const db = await getDb();
  const [people, guests] = await Promise.all([
    listMembers(db),
    db.select().from(members).where(eq(members.kind, 'guest')).orderBy(asc(members.name)),
  ]);

  return (
    <>
      <PageHero kicker="Runde" title="Leute">
        <p className="hero-item text-muted-foreground mt-3 max-w-2xl">
          Wer hier steht, bekommt einen persönlichen Link und zählt freitags als dabei, solange er
          nicht absagt. Gäste brauchen keinen Link, sie werden am Freitag direkt eingetragen.
        </p>
      </PageHero>

      <div className="mx-auto max-w-5xl space-y-12 px-4">
        <section>
          <ChapterHeading icon={UserPlus} kicker="Neu" title="Jemanden dazuholen" />
          <GlassCard variant="tile" className="p-5">
            <CreateMemberForm canGrantAdmin={viewer.isAdmin} />
          </GlassCard>
        </section>

        <section>
          <ChapterHeading
            icon={Users}
            kicker="Mitglieder"
            title={`${people.filter((p) => p.active).length} in der Runde`}
          />
          <div className="grid gap-3 md:grid-cols-2">
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
                      {member.isAdmin && <ShieldCheck className="text-primary size-3.5 shrink-0" />}
                      {member.isDefaultHost && <House className="text-primary size-3.5 shrink-0" />}
                    </div>
                    <div className="text-muted-foreground truncate text-xs">
                      {[member.phone, member.paypalMe && `PayPal: ${member.paypalMe}`]
                        .filter(Boolean)
                        .join(' · ') || 'keine Angaben'}
                    </div>
                  </div>
                  {!member.loginTokenHash && <Badge variant="softWarning">ohne Link</Badge>}
                </div>
                <MemberActions
                  member={member}
                  isAdminViewer={viewer.isAdmin}
                  canIssueLink={viewer.isAdmin || !member.isAdmin || member.id === viewer.id}
                />
              </GlassCard>
            ))}
          </div>
        </section>

        {guests.length > 0 && (
          <section>
            <ChapterHeading
              kicker="Gäste"
              title="Waren schon mal da"
              hint="Wer öfter kommt, kann einen eigenen Link bekommen."
            />
            <div className="grid gap-3 md:grid-cols-2">
              {guests.map((guest) => (
                <GlassCard key={guest.id} variant="tile" className="flex flex-col gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={guest.name} id={guest.id} />
                    <span className="font-bold">{guest.name}</span>
                  </div>
                  <MemberActions member={guest} isAdminViewer={viewer.isAdmin} canIssueLink />
                </GlassCard>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
