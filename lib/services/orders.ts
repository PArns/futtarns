import { and, asc, eq } from 'drizzle-orm';
import type { IsoDate } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import { attendance, dishes, fridays, memberDefaults, orderItems, restaurants } from '@/lib/db/schema';
import { resolveSelection, unitPriceCents } from '@/lib/menu/options';
import { ServiceError } from '@/lib/services/members';

export type DishChoice = {
  dishId: number;
  selection: Record<string, string[]>;
  note: string | null;
};

async function dishWithOptions(db: Db, choice: DishChoice, restaurantId: number) {
  const [dish] = await db
    .select()
    .from(dishes)
    .where(
      and(
        eq(dishes.id, choice.dishId),
        eq(dishes.restaurantId, restaurantId),
        eq(dishes.archived, false)
      )
    );
  if (!dish) throw new ServiceError('Dieses Gericht gibt es hier nicht');
  const resolved = resolveSelection(dish.optionGroups, choice.selection);
  if (!resolved.ok) throw new ServiceError(resolved.error);
  return { dish, options: resolved.options };
}

/** Adds a dish to someone's order for a Friday; ordering means they are coming. */
export async function addItem(
  db: Db,
  date: IsoDate,
  memberId: number,
  choice: DishChoice & { quantity: number }
) {
  const [friday] = await db.select().from(fridays).where(eq(fridays.date, date));
  if (!friday?.restaurantId) throw new ServiceError('Für diesen Freitag steht noch kein Restaurant fest');
  if (friday.cancelled) throw new ServiceError('Dieser Freitag fällt aus');
  const { dish, options } = await dishWithOptions(db, choice, friday.restaurantId);
  const quantity = Math.min(Math.max(Math.round(choice.quantity), 1), 20);

  await db.transaction(async (tx) => {
    await tx.insert(orderItems).values({
      fridayDate: date,
      memberId,
      dishId: dish.id,
      name: dish.name,
      unitPriceCents: unitPriceCents(dish.priceCents, options),
      quantity,
      options,
      note: choice.note,
    });
    await tx
      .insert(attendance)
      .values({ fridayDate: date, memberId, status: 'in' })
      .onConflictDoUpdate({
        target: [attendance.fridayDate, attendance.memberId],
        set: { status: 'in', updatedAt: new Date() },
      });
  });
}

export async function getItem(db: Db, itemId: number) {
  const [item] = await db.select().from(orderItems).where(eq(orderItems.id, itemId));
  return item ?? null;
}

export async function removeItem(db: Db, itemId: number) {
  await db.delete(orderItems).where(eq(orderItems.id, itemId));
}

export async function setItemQuantity(db: Db, itemId: number, quantity: number) {
  if (quantity < 1) return removeItem(db, itemId);
  await db
    .update(orderItems)
    .set({ quantity: Math.min(Math.round(quantity), 20) })
    .where(eq(orderItems.id, itemId));
}

/** Remembers what someone gets from a restaurant when they do not order themselves. */
export async function setDefaultDish(
  db: Db,
  memberId: number,
  restaurantId: number,
  choice: DishChoice
) {
  const { dish, options } = await dishWithOptions(db, choice, restaurantId);
  await db
    .insert(memberDefaults)
    .values({ memberId, restaurantId, dishId: dish.id, options, note: choice.note })
    .onConflictDoUpdate({
      target: [memberDefaults.memberId, memberDefaults.restaurantId],
      set: { dishId: dish.id, options, note: choice.note },
    });
}

export async function removeDefaultDish(db: Db, memberId: number, restaurantId: number) {
  await db
    .delete(memberDefaults)
    .where(and(eq(memberDefaults.memberId, memberId), eq(memberDefaults.restaurantId, restaurantId)));
}

export async function listDefaults(db: Db, memberId: number) {
  return db
    .select({ entry: memberDefaults, dish: dishes, restaurant: restaurants })
    .from(memberDefaults)
    .innerJoin(dishes, eq(dishes.id, memberDefaults.dishId))
    .innerJoin(restaurants, eq(restaurants.id, memberDefaults.restaurantId))
    .where(eq(memberDefaults.memberId, memberId))
    .orderBy(asc(restaurants.name));
}

export async function getDefault(db: Db, memberId: number, restaurantId: number) {
  const [row] = await db
    .select({ entry: memberDefaults, dish: dishes })
    .from(memberDefaults)
    .innerJoin(dishes, eq(dishes.id, memberDefaults.dishId))
    .where(and(eq(memberDefaults.memberId, memberId), eq(memberDefaults.restaurantId, restaurantId)));
  return row ?? null;
}
