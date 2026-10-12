import { and, asc, eq, isNull, max } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { dishes, members, restaurants, type Dish, type Restaurant } from '@/lib/db/schema';
import type { BulkDish } from '@/lib/menu/bulk';
import type { OptionGroup } from '@/lib/menu/options';
import { ServiceError } from '@/lib/services/members';

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
>;

export async function listRestaurants(db: Db, includeArchived = false) {
  const rows = await db.select().from(restaurants).orderBy(asc(restaurants.name));
  return includeArchived ? rows : rows.filter((row) => !row.archived);
}

export async function getRestaurant(db: Db, id: number) {
  const [row] = await db.select().from(restaurants).where(eq(restaurants.id, id));
  return row ?? null;
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
