import { Plus, Sparkles, Store, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ChapterHeading } from '@/components/common/chapter-heading';
import { PageHero } from '@/components/layout/page-hero';
import { RestaurantForm } from '@/components/restaurants/restaurant-form';
import { GlassCard } from '@/components/ui/glass-card';
import { getDb } from '@/lib/db';
import { dishes } from '@/lib/db/schema';
import { formatEuro } from '@/lib/format';
import { getGroupContext } from '@/lib/session';
import { listDefaults } from '@/lib/services/orders';
import { hostsUsing, listMembers } from '@/lib/services/members';
import { listRestaurants } from '@/lib/services/restaurants';
import { count, eq } from 'drizzle-orm';

export const metadata: Metadata = { title: 'Restaurants' };

export default async function RestaurantsPage() {
  const { viewer, canManage } = await getGroupContext();
  const db = await getDb();
  const [restaurants, defaults, people, dishCounts] = await Promise.all([
    listRestaurants(db),
    listDefaults(db, viewer.id),
    listMembers(db),
    db
      .select({ restaurantId: dishes.restaurantId, total: count() })
      .from(dishes)
      .where(eq(dishes.archived, false))
      .groupBy(dishes.restaurantId),
  ]);

  return (
    <>
      <PageHero kicker="Auswahl" title="Restaurants">
        <p className="hero-item text-muted-foreground mt-3 max-w-2xl">
          Unsere Läden mit Karte und Gebühren. Such dir pro Restaurant ein Standardgericht aus – das
          bekommst du, wenn du freitags nichts wählst.
        </p>
      </PageHero>

      <div className="mx-auto max-w-5xl space-y-12 px-4">
        <section>
          <ChapterHeading icon={Store} kicker="Läden" title={`${restaurants.length} Restaurants`} />
          {restaurants.length === 0 ? (
            <GlassCard variant="flat" className="text-muted-foreground p-6 text-center text-sm">
              Noch keine Restaurants.{' '}
              {canManage ? 'Leg unten das erste an.' : 'Der Gastgeber legt sie an.'}
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {restaurants.map((restaurant) => {
                const mine = defaults.find((entry) => entry.restaurant.id === restaurant.id);
                const hosts = hostsUsing(people, restaurant.id);
                const total =
                  dishCounts.find((entry) => entry.restaurantId === restaurant.id)?.total ?? 0;
                return (
                  <Link
                    key={restaurant.id}
                    href={`/restaurants/${restaurant.id}`}
                    className="group"
                  >
                    <GlassCard
                      variant="tile"
                      className="group-hover:border-primary/50 h-full p-0 transition-colors"
                    >
                      <div className="brand-gradient relative h-20 overflow-hidden rounded-t-xl">
                        <span className="absolute bottom-2 left-4 text-[11px] font-bold tracking-[0.14em] text-white/80 uppercase">
                          {restaurant.cuisine ?? 'Restaurant'}
                        </span>
                        {hosts && (
                          <span className="absolute top-2 right-3 max-w-[70%] truncate rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#1665e6] uppercase">
                            Standard bei {hosts}
                          </span>
                        )}
                      </div>
                      <div className="space-y-2 p-4">
                        <div className="group-hover:text-primary text-[17px] leading-tight font-extrabold tracking-tight transition-colors">
                          {restaurant.name}
                        </div>
                        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="inline-flex items-center gap-1">
                            <Truck className="size-3.5" /> {formatEuro(restaurant.deliveryFeeCents)}
                          </span>
                          {restaurant.minOrderCents > 0 && (
                            <span>ab {formatEuro(restaurant.minOrderCents)}</span>
                          )}
                          <span>{total} Gerichte</span>
                        </div>
                        {mine && (
                          <div className="text-primary flex items-center gap-1 text-xs font-semibold">
                            <Sparkles className="size-3.5" />{' '}
                            {mine.dish ? mine.dish.name : 'Nix essen'}
                          </div>
                        )}
                      </div>
                    </GlassCard>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {canManage && (
          <section>
            <ChapterHeading icon={Plus} kicker="Neu" title="Restaurant anlegen" />
            <GlassCard variant="tile" className="p-5">
              <RestaurantForm />
            </GlassCard>
          </section>
        )}
      </div>
    </>
  );
}
