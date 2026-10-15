import {
  ClipboardPaste,
  ExternalLink,
  Pencil,
  Plus,
  Settings2,
  Sparkles,
  Store,
  Truck,
} from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChapterHeading } from '@/components/common/chapter-heading';
import type { MenuDish } from '@/components/friday/dish-dialog';
import { Menu } from '@/components/friday/menu';
import { PageHero } from '@/components/layout/page-hero';
import {
  NoFoodDefaultButton,
  RemoveDefaultButton,
} from '@/components/profile/remove-default-button';
import {
  ArchiveDishButton,
  DeleteAllDishesButton,
  DishForm,
} from '@/components/restaurants/dish-form';
import { DefaultRestaurantButton } from '@/components/restaurants/default-restaurant-button';
import { LieferandoBookmarklet } from '@/components/restaurants/lieferando-bookmarklet';
import { MenuImport } from '@/components/restaurants/menu-import';
import { RestaurantActions } from '@/components/restaurants/restaurant-actions';
import { RestaurantForm } from '@/components/restaurants/restaurant-form';
import { buttonVariants } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { getDb } from '@/lib/db';
import { formatEuro } from '@/lib/format';
import { getGroupContext } from '@/lib/session';
import { hostsUsing, listMembers } from '@/lib/services/members';
import { getDefault } from '@/lib/services/orders';
import { getRestaurant, listDishes, restaurantHostIds } from '@/lib/services/restaurants';
import { cn } from '@/lib/utils';

async function load(id: string) {
  const restaurantId = Number(id);
  if (!Number.isInteger(restaurantId) || restaurantId <= 0) notFound();
  const restaurant = await getRestaurant(await getDb(), restaurantId);
  if (!restaurant) notFound();
  return restaurant;
}

export async function generateMetadata(props: PageProps<'/restaurants/[id]'>): Promise<Metadata> {
  const { id } = await props.params;
  return { title: (await load(id)).name };
}

export default async function RestaurantPage(props: PageProps<'/restaurants/[id]'>) {
  const { id } = await props.params;
  const restaurant = await load(id);
  const { viewer, canManage } = await getGroupContext();
  const db = await getDb();
  const [allDishes, myDefault, people, deliversTo] = await Promise.all([
    listDishes(db, restaurant.id, canManage),
    getDefault(db, viewer.id, restaurant.id),
    listMembers(db),
    restaurantHostIds(db, restaurant.id),
  ]);
  const hosts = hostsUsing(people, restaurant.id);
  const mineAsHost = viewer.defaultRestaurantId === restaurant.id;
  const menu: MenuDish[] = allDishes.filter((dish) => !dish.archived);

  return (
    <>
      <PageHero
        icon={Store}
        kicker={
          restaurant.archived
            ? 'Nicht mehr im Angebot'
            : hosts
              ? `Standard bei ${hosts} · ${restaurant.cuisine ?? 'Restaurant'}`
              : (restaurant.cuisine ?? 'Restaurant')
        }
        title={restaurant.name}
      >
        <div className="hero-item text-muted-foreground mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <Truck className="text-primary size-4" /> Lieferung{' '}
            {formatEuro(restaurant.deliveryFeeCents)}
            {restaurant.freeDeliveryFromCents !== null &&
              `, ab ${formatEuro(restaurant.freeDeliveryFromCents)} gratis`}
          </span>
          {restaurant.minOrderCents > 0 && (
            <span>Mindestbestellwert {formatEuro(restaurant.minOrderCents)}</span>
          )}
          {restaurant.serviceFeeCents > 0 && (
            <span>Servicegebühr {formatEuro(restaurant.serviceFeeCents)}</span>
          )}
          <span>
            {restaurant.tipCents > 0
              ? `Trinkgeld ${formatEuro(restaurant.tipCents)}`
              : 'ohne Trinkgeld'}
          </span>
        </div>
        {restaurant.notes && <p className="hero-item mt-3 text-sm">{restaurant.notes}</p>}
        {(restaurant.lieferandoUrl || (!mineAsHost && !restaurant.archived)) && (
          <div className="hero-item mt-5 flex flex-wrap gap-2">
            {restaurant.lieferandoUrl && (
              <a
                href={restaurant.lieferandoUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'outline' })}
              >
                <ExternalLink /> Bei Lieferando ansehen
              </a>
            )}
            {!mineAsHost && !restaurant.archived && <DefaultRestaurantButton id={restaurant.id} />}
          </div>
        )}
      </PageHero>

      <div className="mx-auto max-w-5xl space-y-12 px-4">
        <section>
          <ChapterHeading
            icon={Sparkles}
            kicker="Das Übliche"
            title={myDefault ? (myDefault.dish?.name ?? 'Nix essen') : 'Noch kein Standard'}
            hint={
              myDefault && !myDefault.dish
                ? 'Sagst du nichts, kommst du ohne Essen. Tippe ein Gericht an, wenn du doch einen Standard willst.'
                : 'Das bekommst du, wenn du freitags dabei bist, aber bis zum Bestellschluss nichts wählst. Tippe ein Gericht an, um es als Standard zu merken.'
            }
            action={
              <div className="flex gap-1">
                {myDefault?.dish !== null && <NoFoodDefaultButton restaurantId={restaurant.id} />}
                {myDefault && <RemoveDefaultButton restaurantId={restaurant.id} />}
              </div>
            }
          />
          <Menu
            dishes={menu}
            mode="default"
            restaurantId={restaurant.id}
            targets={[{ id: viewer.id, name: viewer.name, isSelf: true }]}
            initialTargetId={viewer.id}
            defaultDishId={myDefault?.dish?.id ?? null}
          />
        </section>

        {canManage && (
          <>
            <section>
              <ChapterHeading
                icon={ClipboardPaste}
                kicker="Copy & Paste"
                title="Karte übernehmen"
                hint="Lieferando lässt keine automatischen Abrufe zu, deshalb kommt die Karte über deinen Browser."
                id="karte-einfuegen"
              />
              <GlassCard variant="tile" className="space-y-5 p-5">
                <LieferandoBookmarklet restaurantId={restaurant.id} />
                <div className="space-y-1 text-sm">
                  <div className="font-semibold">Oder von Hand (auch am Handy)</div>
                  <p className="text-muted-foreground">
                    {restaurant.lieferandoUrl ? (
                      <a
                        href={restaurant.lieferandoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        Die Karte bei Lieferando öffnen
                      </a>
                    ) : (
                      'Die Karte bei Lieferando öffnen'
                    )}
                    , die Gerichte markieren und kopieren, hier einfügen. Mit „# Name“ setzt du
                    selbst eine Kategorie.
                  </p>
                </div>
                <MenuImport restaurantId={restaurant.id} />
              </GlassCard>
            </section>

            <section>
              <ChapterHeading icon={Plus} kicker="Fehlt was?" title="Gericht hinzufügen" />
              <GlassCard variant="tile" className="p-5">
                <DishForm restaurantId={restaurant.id} />
              </GlassCard>
            </section>

            {allDishes.length > 0 && (
              <section>
                <ChapterHeading
                  icon={Pencil}
                  kicker="Feinschliff"
                  title="Gerichte bearbeiten"
                  hint="Archivierte Gerichte bleiben in alten Bestellungen erhalten."
                  action={
                    <DeleteAllDishesButton restaurantId={restaurant.id} count={allDishes.length} />
                  }
                />
                <div className="space-y-2">
                  {allDishes.map((dish) => (
                    <details
                      key={dish.id}
                      className={cn(
                        'group glass-tile rounded-xl border',
                        dish.archived && 'opacity-50'
                      )}
                    >
                      <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold">
                            {dish.name}
                            {dish.category && (
                              <span className="text-muted-foreground ml-2 text-xs font-normal">
                                {dish.category}
                              </span>
                            )}
                          </div>
                          {dish.optionGroups.length > 0 && (
                            <div className="text-muted-foreground truncate text-xs">
                              {dish.optionGroups.map((group) => group.name).join(' · ')}
                            </div>
                          )}
                        </div>
                        <span className="text-sm font-semibold tabular-nums">
                          {formatEuro(dish.priceCents)}
                        </span>
                        <ArchiveDishButton
                          restaurantId={restaurant.id}
                          dishId={dish.id}
                          archived={dish.archived}
                        />
                      </summary>
                      <div className="border-border/50 border-t p-4">
                        <DishForm restaurantId={restaurant.id} dish={dish} />
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            )}

            <section>
              <ChapterHeading
                icon={Settings2}
                kicker="Kleingedrucktes"
                title="Daten und Gebühren"
              />
              <GlassCard variant="tile" className="space-y-5 p-5">
                <RestaurantForm
                  restaurant={restaurant}
                  members={people.filter(
                    (person) => person.kind === 'member' && person.active && person.core
                  )}
                  deliversTo={deliversTo}
                />
                <div className="border-border/50 border-t pt-4">
                  <RestaurantActions
                    id={restaurant.id}
                    name={restaurant.name}
                    archived={restaurant.archived}
                  />
                </div>
              </GlassCard>
            </section>
          </>
        )}
      </div>
    </>
  );
}
