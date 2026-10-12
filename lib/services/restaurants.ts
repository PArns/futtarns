import { asc, eq, and, max } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { dishes, restaurants, type Dish, type Restaurant } from '@/lib/db/schema';
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

export async function createDish(db: Db, restaurantId: number, input: DishInput) {
  if (!(await getRestaurant(db, restaurantId))) throw new ServiceError('Restaurant nicht gefunden');
  await db
    .insert(dishes)
    .values({ ...input, restaurantId, sortOrder: await nextSortOrder(db, restaurantId) });
}

/** Adds the dishes from a pasted menu in the order they were written. */
export async function createDishes(db: Db, restaurantId: number, input: BulkDish[]) {
  if (input.length === 0) return;
  if (!(await getRestaurant(db, restaurantId))) throw new ServiceError('Restaurant nicht gefunden');
  const start = await nextSortOrder(db, restaurantId);
  await db
    .insert(dishes)
    .values(input.map((dish, index) => ({ ...dish, restaurantId, sortOrder: start + index })));
}

export async function updateDish(db: Db, restaurantId: number, dishId: number, input: DishInput) {
  await db
    .update(dishes)
    .set(input)
    .where(and(eq(dishes.id, dishId), eq(dishes.restaurantId, restaurantId)));
}

/** Archives instead of deleting, because past orders and defaults point at the dish. */
export async function setDishArchived(db: Db, restaurantId: number, dishId: number, archived: boolean) {
  await db
    .update(dishes)
    .set({ archived })
    .where(and(eq(dishes.id, dishId), eq(dishes.restaurantId, restaurantId)));
}
