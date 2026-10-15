import { and, asc, eq } from 'drizzle-orm';
import type { IsoDate } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import {
  attendance,
  dishes,
  fridays,
  memberDefaults,
  orderItems,
  restaurants,
} from '@/lib/db/schema';
import { resolveSelection, selectionOf, unitPriceCents } from '@/lib/menu/options';
import { castVote, currentRestaurantId, setAttendance, voteState } from '@/lib/services/fridays';
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

/**
 * Adds a dish to someone's order for a Friday; ordering means they are coming. It comes
 * from the Friday's restaurant unless `from` names another: while the vote runs, a member
 * can order ahead from the restaurant they vote for, and `vote` (ordering from the ballot)
 * casts that vote first. A dish from the current restaurant leaves a vote for another one
 * alone, so a member can have both: what they want and a fallback.
 */
export async function addItem(
  db: Db,
  date: IsoDate,
  memberId: number,
  choice: DishChoice & { quantity: number },
  { from, vote = false, now = new Date() }: { from?: number; vote?: boolean; now?: Date } = {}
) {
  const [friday] = await db.select().from(fridays).where(eq(fridays.date, date));
  if (friday?.cancelled) throw new ServiceError('Dieser Freitag fällt aus');
  if (friday?.mode === 'flat') throw new ServiceError('An diesem Freitag gibt es eine Pauschale');
  const currentId = await currentRestaurantId(db, date);
  const restaurantId = from ?? currentId;
  if (!restaurantId) throw new ServiceError('Für diesen Freitag steht noch kein Restaurant fest');
  const { dish, options } = await dishWithOptions(db, choice, restaurantId);
  const { open, votedFor } = await voteState(db, date, memberId, now);
  if (restaurantId !== currentId) {
    // Ordering ahead: only from the restaurant this member votes for, while the vote runs.
    if (!open || (!vote && votedFor !== restaurantId)) {
      throw new ServiceError(
        'Vorbestellen geht nur beim Restaurant, das du gewählt hast, solange die Wahl läuft'
      );
    }
    if (votedFor !== restaurantId) await castVote(db, date, memberId, restaurantId, now);
  } else {
    // A dish from the current restaurant is the fallback in case another one wins: from the
    // ballot it is a vote only from whoever has not voted yet.
    if (vote && open && votedFor === null) {
      await castVote(db, date, memberId, restaurantId, now);
    }
    if (!friday?.restaurantId) {
      // The first order on the host's usual restaurant pins it to this Friday, so a new host
      // or a changed default does not leave these orders pointing at the wrong menu.
      await db
        .insert(fridays)
        .values({ date, restaurantId })
        .onConflictDoUpdate({ target: fridays.date, set: { restaurantId } });
    }
  }
  const quantity = Math.min(Math.max(Math.round(choice.quantity), 1), 20);

  await db.transaction(async (tx) => {
    await tx.insert(orderItems).values({
      fridayDate: date,
      memberId,
      restaurantId,
      dishId: dish.id,
      name: dish.name,
      category: dish.category,
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

/** Sets „nix“ as someone's default here: silent means coming without food. */
export async function setNoFoodDefault(db: Db, memberId: number, restaurantId: number) {
  await db
    .insert(memberDefaults)
    .values({ memberId, restaurantId, dishId: null, options: [], note: null })
    .onConflictDoUpdate({
      target: [memberDefaults.memberId, memberDefaults.restaurantId],
      set: { dishId: null, options: [], note: null },
    });
}

export async function removeDefaultDish(db: Db, memberId: number, restaurantId: number) {
  await db
    .delete(memberDefaults)
    .where(
      and(eq(memberDefaults.memberId, memberId), eq(memberDefaults.restaurantId, restaurantId))
    );
}

export async function listDefaults(db: Db, memberId: number) {
  return db
    .select({ entry: memberDefaults, dish: dishes, restaurant: restaurants })
    .from(memberDefaults)
    .leftJoin(dishes, eq(dishes.id, memberDefaults.dishId))
    .innerJoin(restaurants, eq(restaurants.id, memberDefaults.restaurantId))
    .where(eq(memberDefaults.memberId, memberId))
    .orderBy(asc(restaurants.name));
}

/** Who has a default dish (not „nix“) at a restaurant. */
export async function membersWithDefault(db: Db, restaurantId: number): Promise<Set<number>> {
  const rows = await db
    .select({ memberId: memberDefaults.memberId })
    .from(memberDefaults)
    .innerJoin(dishes, eq(dishes.id, memberDefaults.dishId))
    .where(and(eq(memberDefaults.restaurantId, restaurantId), eq(dishes.archived, false)));
  return new Set(rows.map((row) => row.memberId));
}

export async function getDefault(db: Db, memberId: number, restaurantId: number) {
  const [row] = await db
    .select({ entry: memberDefaults, dish: dishes })
    .from(memberDefaults)
    .leftJoin(dishes, eq(dishes.id, memberDefaults.dishId))
    .where(
      and(eq(memberDefaults.memberId, memberId), eq(memberDefaults.restaurantId, restaurantId))
    );
  return row ?? null;
}

/**
 * „wie immer“: orders someone's default for this Friday's restaurant now instead of at the
 * deadline. A „nix“ default means coming without food. Null when there is no default here.
 */
export async function orderUsual(
  db: Db,
  date: IsoDate,
  memberId: number,
  restaurantId: number
): Promise<{ dish: string } | { noFood: true } | null> {
  const usual = await getDefault(db, memberId, restaurantId);
  if (!usual) return null;
  if (!usual.dish) {
    await setAttendance(db, date, memberId, 'nofood');
    return { noFood: true };
  }
  await addItem(db, date, memberId, {
    dishId: usual.dish.id,
    selection: selectionOf(usual.entry.options),
    note: usual.entry.note,
    quantity: 1,
  });
  return { dish: usual.dish.name };
}
