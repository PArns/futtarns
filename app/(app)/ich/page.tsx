import { Bot, CalendarPlus, CircleUser, LogOut, Sparkles, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { logoutAction } from '@/app/actions';
import { ChapterHeading } from '@/components/common/chapter-heading';
import { CopyButton } from '@/components/common/copy-button';
import { PageHero } from '@/components/layout/page-hero';
import { McpAccess } from '@/components/profile/mcp-access';
import { ProfileForm } from '@/components/profile/profile-form';
import { RemoveDefaultButton } from '@/components/profile/remove-default-button';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { appUrl, calendarLink } from '@/lib/auth-tokens';
import { todayIso } from '@/lib/dates';
import { getDb } from '@/lib/db';
import { formatDayShort, formatTime } from '@/lib/format';
import { getGroupContext } from '@/lib/session';
import { listMcpTokens } from '@/lib/services/auth';
import { listDefaults } from '@/lib/services/orders';
import { listRestaurants } from '@/lib/services/restaurants';

export const metadata: Metadata = { title: 'Ich' };

/** `14. Okt., 18:05` in Berlin time. */
function when(at: Date): string {
  return `${formatDayShort(todayIso(at))}, ${formatTime(at)}`;
}

export default async function ProfilePage() {
  const { viewer } = await getGroupContext();
  const db = await getDb();
  const [defaults, restaurants, mcpKeys] = await Promise.all([
    listDefaults(db, viewer.id),
    listRestaurants(db),
    listMcpTokens(db, viewer.id),
  ]);
  const feed = viewer.calendarToken ? calendarLink(viewer.calendarToken) : null;

  return (
    <>
      <PageHero icon={CircleUser} kicker="Das bist du" title={viewer.name}>
        <div className="hero-item mt-4 flex flex-wrap items-center gap-3">
          <Avatar name={viewer.name} id={viewer.id} className="size-10 text-sm" />
          {viewer.isAdmin && <Badge variant="primary">Admin</Badge>}
          {viewer.isDefaultHost && <Badge variant="soft">Gastgeber</Badge>}
          <form action={logoutAction} className="ml-auto">
            <Button type="submit" variant="ghost" size="sm">
              <LogOut /> Abmelden
            </Button>
          </form>
        </div>
      </PageHero>

      <div className="mx-auto max-w-7xl space-y-12 px-4">
        <section>
          <ChapterHeading icon={UserRound} kicker="Steckbrief" title="Deine Angaben" />
          <GlassCard variant="tile" className="p-5">
            <ProfileForm
              name={viewer.name}
              phone={viewer.phone}
              paypalMe={viewer.paypalMe}
              address={viewer.address}
              defaultRestaurantId={viewer.defaultRestaurantId}
              restaurants={restaurants.map(({ id, name }) => ({ id, name }))}
            />
          </GlassCard>
        </section>

        <section>
          <ChapterHeading
            icon={Sparkles}
            kicker="Das Übliche"
            title="Deine Standardgerichte"
            hint="Das bekommst du, wenn du dabei bist und bis zum Bestellschluss nichts aussuchst. Festlegen kannst du es auf der Seite des Restaurants."
          />
          <GlassCard variant="tile" className="p-5">
            {defaults.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Noch keins. Such dir bei den{' '}
                <Link href="/restaurants" className="text-primary hover:underline">
                  Restaurants
                </Link>{' '}
                eins aus.
              </p>
            ) : (
              <ul className="divide-border/50 divide-y">
                {defaults.map(({ entry, dish, restaurant }) => (
                  <li key={restaurant.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/restaurants/${restaurant.id}`}
                        className="text-muted-foreground hover:text-primary text-xs"
                      >
                        {restaurant.name}
                      </Link>
                      <div className="truncate font-semibold">
                        {dish ? dish.name : 'Nix essen'}
                        {entry.options.length > 0 && (
                          <span className="text-muted-foreground font-normal">
                            {' '}
                            · {entry.options.map((option) => option.choiceName).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <RemoveDefaultButton restaurantId={restaurant.id} />
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </section>

        <section>
          <ChapterHeading
            icon={Bot}
            kicker="Für Claude & Co."
            title="MCP-Zugang"
            hint={`Mit einem Schlüssel kann Claude (etwa Claude Code oder Claude Desktop) freitach für dich lesen und bedienen: Freitage, Bestellungen, Abwesenheiten${viewer.isAdmin ? ', als Admin auch die Bot-Chats, Meldungen und Nachrichten an andere' : ''} – immer mit genau deinen Rechten.`}
          />
          <GlassCard variant="tile" className="p-5">
            <McpAccess
              endpoint={`${appUrl()}/api/mcp`}
              keys={mcpKeys.map((key) => ({
                id: key.id,
                name: key.name,
                created: when(key.createdAt),
                lastUsed: key.lastUsedAt ? when(key.lastUsedAt) : null,
              }))}
            />
          </GlassCard>
        </section>

        {feed && (
          <section>
            <ChapterHeading
              icon={CalendarPlus}
              kicker="Nie wieder vergessen"
              title="Freitage im Handykalender"
              hint="Abonnier den Link, dann stehen Gastgeber, Restaurant und Absagen automatisch in deinem Kalender."
            />
            <GlassCard variant="tile" className="flex flex-wrap items-center gap-3 p-5">
              <code className="bg-muted/60 min-w-0 flex-1 truncate rounded-md px-3 py-2 text-xs">
                {feed}
              </code>
              <CopyButton text={feed} />
            </GlassCard>
          </section>
        )}
      </div>
    </>
  );
}
