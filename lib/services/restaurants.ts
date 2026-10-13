import { and, asc, count, eq, isNull, max } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import {
  dishes,
  fridays,
  members,
  restaurantHosts,
  restaurants,
  type Dish,
  type Restaurant,
} from '@/lib/db/schema';
import type { BulkDish } from '@/lib/menu/bulk';
import type { OptionGroup } from '@/lib/menu/options';
import { ServiceError } from '@/lib/services/members';
import type { VoteOption } from '@/lib/vote';

export type RestaurantInput = Pick<
  Restaurant,
  | 'name'
  | 'cuisine'
  | 'lieferandoUrl'
  | 'minOrderCents'
  | 'deliveryFeeCents'
  | 'freeDeliveryFromCents'
  | 'serviceFeeCents'
  | 'notes'
> &
  Partial<Pick<Restaurant, 'pickup'>>;

export async function listRestaurants(db: Db, includeArchived = false) {
  const rows = await db.select().from(restaurants).orderBy(asc(restaurants.name));
  return includeArchived ? rows : rows.filter((row) => !row.archived);
}

export async function getRestaurant(db: Db, id: number) {
  const [row] = await db.select().from(restaurants).where(eq(restaurants.id, id));
  return row ?? null;
}

/** The hosts a restaurant delivers to; empty means everyone. */
export async function restaurantHostIds(db: Db, restaurantId: number): Promise<number[]> {
  const rows = await db
    .select({ memberId: restaurantHosts.memberId })
    .from(restaurantHosts)
    .where(eq(restaurantHosts.restaurantId, restaurantId));
  return rows.map((row) => row.memberId);
}

export async function setRestaurantHosts(db: Db, restaurantId: number, memberIds: number[]) {
  await db.transaction(async (tx) => {
    await tx.delete(restaurantHosts).where(eq(restaurantHosts.restaurantId, restaurantId));
    if (memberIds.length > 0) {
      await tx
        .insert(restaurantHosts)
        .values([...new Set(memberIds)].map((memberId) => ({ restaurantId, memberId })));
    }
  });
}

/**
 * The restaurants a Friday hosted by `hostId` can order from, oldest first so the vote's
 * letters stay put: those that deliver to the host, and those that offer pickup, which can
 * always be fetched.
 */
export async function restaurantsForHost(db: Db, hostId: number | null): Promise<VoteOption[]> {
  const [rows, areas, menus] = await Promise.all([
    db
      .select()
      .from(restaurants)
      .where(eq(restaurants.archived, false))
      .orderBy(asc(restaurants.id)),
    db.select().from(restaurantHosts),
    db
      .select({ restaurantId: dishes.restaurantId, dishes: count() })
      .from(dishes)
      .where(eq(dishes.archived, false))
      .groupBy(dishes.restaurantId),
  ]);
  return rows
    .map((row) => {
      const hosts = areas.filter((area) => area.restaurantId === row.id);
      return {
        id: row.id,
        name: row.name,
        cuisine: row.cuisine,
        lieferandoUrl: row.lieferandoUrl,
        delivers: hosts.length === 0 || hosts.some((area) => area.memberId === hostId),
        pickup: row.pickup,
        minOrderCents: row.minOrderCents,
        deliveryFeeCents: row.deliveryFeeCents,
        freeDeliveryFromCents: row.freeDeliveryFromCents,
        dishCount: menus.find((menu) => menu.restaurantId === row.id)?.dishes ?? 0,
      };
    })
    .filter((option) => option.delivers || option.pickup);
}

/** The restaurant a Friday hosted by `hostId` uses when nobody picks another one. */
export async function hostRestaurant(db: Db, hostId: number | null): Promise<Restaurant | null> {
  if (!hostId) return null;
  const [row] = await db
    .select({ restaurant: restaurants })
    .from(members)
    .innerJoin(restaurants, eq(restaurants.id, members.defaultRestaurantId))
    .where(and(eq(members.id, hostId), eq(restaurants.archived, false)));
  return row?.restaurant ?? null;
}

export async function setHostRestaurant(db: Db, memberId: number, restaurantId: number | null) {
  await db
    .update(members)
    .set({ defaultRestaurantId: restaurantId })
    .where(eq(members.id, memberId));
}

/**
 * On an empty database, adds the group's usual restaurant (`DEFAULT_RESTAURANT_*`) and
 * makes it the default host's, so the first Friday already has one; its menu is pasted in
 * afterwards.
 */
export async function bootstrapRestaurant(db: Db, env: { name?: string; url?: string }) {
  if (!env.name) return;
  const [any] = await db.select({ id: restaurants.id }).from(restaurants).limit(1);
  if (any) return;
  const [created] = await db
    .insert(restaurants)
    .values({ name: env.name, lieferandoUrl: env.url || null })
    .returning();
  await db
    .update(members)
    .set({ defaultRestaurantId: created!.id })
    .where(and(eq(members.isDefaultHost, true), isNull(members.defaultRestaurantId)));
}

export async function createRestaurant(db: Db, input: RestaurantInput): Promise<Restaurant> {
  const [row] = await db.insert(restaurants).values(input).returning();
  return row!;
}

export async function updateRestaurant(db: Db, id: number, input: Partial<RestaurantInput>) {
  await db.update(restaurants).set(input).where(eq(restaurants.id, id));
}

/**
 * Deletes a restaurant together with its menu. One a Friday already ran on stays for that
 * Friday's sake and can only be taken off the list.
 */
export async function deleteRestaurant(db: Db, id: number) {
  const [used] = await db
    .select({ date: fridays.date })
    .from(fridays)
    .where(eq(fridays.restaurantId, id))
    .limit(1);
  if (used) {
    throw new ServiceError(
      'Bei diesem Restaurant wurde schon bestellt. Nimm es stattdessen aus dem Angebot.'
    );
  }
  await db.delete(restaurants).where(eq(restaurants.id, id));
}

export async function setRestaurantArchived(db: Db, id: number, archived: boolean) {
  await db.update(restaurants).set({ archived }).where(eq(restaurants.id, id));
}

export async function listDishes(db: Db, restaurantId: number, includeArchived = false) {
  const rows = await db
    .select()
    .from(dishes)
    .where(eq(dishes.restaurantId, restaurantId))
    .orderBy(asc(dishes.sortOrder), asc(dishes.id));
  return includeArchived ? rows : rows.filter((row) => !row.archived);
}

export type DishInput = Pick<Dish, 'category' | 'name' | 'description' | 'priceCents'> & {
  optionGroups: OptionGroup[];
};

async function nextSortOrder(db: Db, restaurantId: number) {
  const [row] = await db
    .select({ value: max(dishes.sortOrder) })
    .from(dishes)
    .where(eq(dishes.restaurantId, restaurantId));
  return (row?.value ?? 0) + 1;
}

export async function createDish(
  db: Db,
  restaurantId: number,
  input: DishInput,
  createdById: number | null = null
): Promise<Dish> {
  if (!(await getRestaurant(db, restaurantId))) throw new ServiceError('Restaurant nicht gefunden');
  const [dish] = await db
    .insert(dishes)
    .values({
      ...input,
      restaurantId,
      createdById,
      sortOrder: await nextSortOrder(db, restaurantId),
    })
    .returning();
  return dish!;
}

const MISSING_DISH_MAX_CENTS = 10_000;

/**
 * A dish somebody found missing while ordering. Every member may add one, so it gets its
 * own category, a sane price and no second entry for a dish the card already has.
 */
export async function addMissingDish(
  db: Db,
  restaurantId: number,
  input: Pick<Dish, 'name' | 'description' | 'priceCents'>,
  createdById: number
): Promise<Dish> {
  const restaurant = await getRestaurant(db, restaurantId);
  if (!restaurant || restaurant.archived) throw new ServiceError('Restaurant nicht gefunden');
  if (input.priceCents <= 0 || input.priceCents > MISSING_DISH_MAX_CENTS) {
    throw new ServiceError('Preis: bitte einen Betrag zwischen 0,01 € und 100 € eingeben');
  }
  const name = input.name.toLowerCase();
  if ((await listDishes(db, restaurantId)).some((dish) => dish.name.toLowerCase() === name)) {
    throw new ServiceError(`${input.name} steht schon auf der Karte – such einfach danach`);
  }
  return createDish(
    db,
    restaurantId,
    { ...input, category: 'Selbst eingetragen', optionGroups: [] },
    createdById
  );
}

/**
 * Adds the dishes from a pasted menu in the order they were written. A dish that is already
 * on the card (same name) gets the new price and text instead of a second entry, so pasting
 * an updated menu refreshes it.
 */
export async function createDishes(db: Db, restaurantId: number, input: BulkDish[]) {
  if (input.length === 0) return { added: 0, updated: 0 };
  if (!(await getRestaurant(db, restaurantId))) throw new ServiceError('Restaurant nicht gefunden');
  const existing = await listDishes(db, restaurantId, true);
  const byName = new Map(existing.map((dish) => [dish.name.toLowerCase(), dish]));
  let sortOrder = await nextSortOrder(db, restaurantId);
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;
  for (const dish of input) {
    const name = dish.name.toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    const match = byName.get(name);
    if (match) {
      await db
        .update(dishes)
        .set({
          priceCents: dish.priceCents,
          description: dish.description ?? match.description,
          category: dish.category ?? match.category,
          archived: false,
        })
        .where(eq(dishes.id, match.id));
      updated++;
    } else {
      await db.insert(dishes).values({ ...dish, restaurantId, sortOrder: sortOrder++ });
      added++;
    }
  }
  return { added, updated };
}

export async function updateDish(db: Db, restaurantId: number, dishId: number, input: DishInput) {
  await db
    .update(dishes)
    .set(input)
    .where(and(eq(dishes.id, dishId), eq(dishes.restaurantId, restaurantId)));
}

/**
 * Clears a restaurant's whole menu, e.g. before importing it again. Orders keep the name
 * and price they copied; defaults pointing at these dishes go with them.
 */
export async function deleteAllDishes(db: Db, restaurantId: number): Promise<number> {
  const removed = await db
    .delete(dishes)
    .where(eq(dishes.restaurantId, restaurantId))
    .returning({ id: dishes.id });
  return removed.length;
}

/** Archives instead of deleting, because past orders and defaults point at the dish. */
export async function setDishArchived(
  db: Db,
  restaurantId: number,
  dishId: number,
  archived: boolean
) {
  await db
    .update(dishes)
    .set({ archived })
    .where(and(eq(dishes.id, dishId), eq(dishes.restaurantId, restaurantId)));
}
