import { and, asc, desc, eq, lt } from 'drizzle-orm';
import type { IsoDate } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import {
  attendance,
  dishes,
  fridays,
  memberDefaults,
  orderItems,
  restaurants,
  type OrderItem,
} from '@/lib/db/schema';
import {
  resolveSelection,
  selectionOf,
  unitPriceCents,
  type SelectedOption,
} from '@/lib/menu/options';
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
 * alone, so a member can have both: what they want and a fallback. The same dish again
 * raises the quantity of its line (`more`), unless it comes right after: then it was a double
 * tap and nothing changes (`repeated`), unless `again` says the member asked for one more.
 */
export async function addItem(
  db: Db,
  date: IsoDate,
  memberId: number,
  choice: DishChoice & { quantity: number },
  {
    from,
    vote = false,
    again = false,
    now = new Date(),
  }: { from?: number; vote?: boolean; again?: boolean; now?: Date } = {}
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
  const note = choice.note?.trim() || null;
  const price = unitPriceCents(dish.priceCents, options);

  return db.transaction(async (tx) => {
    // The answer first: its row lock makes a second add of the same person wait for this one.
    await tx
      .insert(attendance)
      .values({ fridayDate: date, memberId, status: 'in' })
      .onConflictDoUpdate({
        target: [attendance.fridayDate, attendance.memberId],
        set: { status: 'in', updatedAt: now },
      });
    // The same dish with the same options and note goes onto the line already there, so a
    // second one shows as „2×“; the same one again within seconds is a double tap. A line
    // whose price was changed by hand keeps that price to itself.
    const [same] = (
      await tx
        .select()
        .from(orderItems)
        .where(
          and(
            eq(orderItems.fridayDate, date),
            eq(orderItems.memberId, memberId),
            eq(orderItems.restaurantId, restaurantId),
            eq(orderItems.dishId, dish.id),
            eq(orderItems.isDefault, false)
          )
        )
    ).filter(
      (item) =>
        sameOptions(item.options, options) &&
        (item.note ?? null) === note &&
        item.unitPriceCents === price
    );
    if (same) {
      if (!again && now.getTime() - same.createdAt.getTime() < DOUBLE_TAP_MS) {
        return { outcome: 'repeated' as const, name: dish.name };
      }
      await tx
        .update(orderItems)
        .set({ quantity: Math.min(same.quantity + quantity, 20) })
        .where(eq(orderItems.id, same.id));
      return { outcome: 'more' as const, name: dish.name };
    }
    await tx.insert(orderItems).values({
      fridayDate: date,
      memberId,
      restaurantId,
      dishId: dish.id,
      name: dish.name,
      category: dish.category,
      unitPriceCents: price,
      quantity,
      options,
      note,
      createdAt: now,
    });
    return { outcome: 'added' as const, name: dish.name };
  });
}

/** A second tap on „Bestellen“ this soon after the first is not a second dish. */
const DOUBLE_TAP_MS = 10_000;

function sameOptions(a: SelectedOption[], b: SelectedOption[]): boolean {
  const key = (options: SelectedOption[]) =>
    options
      .map((option) => `${option.groupId}:${option.choiceId}`)
      .sort()
      .join('|');
  return key(a) === key(b);
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

const ITEM_MAX_CENTS = 10_000;

/**
 * Sets what one of an order line costs, for what the menu does not know: a large pizza where
 * it only lists the small one, or an extra the restaurant charges for.
 */
export async function setItemPrice(db: Db, itemId: number, unitPriceCents: number) {
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0 || unitPriceCents > ITEM_MAX_CENTS) {
    throw new ServiceError('Preis: bitte einen Betrag zwischen 0 € und 100 € eingeben');
  }
  await db.update(orderItems).set({ unitPriceCents }).where(eq(orderItems.id, itemId));
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

/** `2× Margherita (Groß)`: one line of an order as a message names it. */
export function itemLabel(item: Pick<OrderItem, 'name' | 'quantity' | 'options'>): string {
  const options = item.options.map((option) => option.choiceName).join(', ');
  return `${item.quantity > 1 ? `${item.quantity}× ` : ''}${item.name}${options ? ` (${options})` : ''}`;
}

/**
 * What each member had the last time they ate from a restaurant before a Friday: all the
 * dishes of their latest earlier order there. For „gleiches“ and the messages offering it.
 */
export async function lastOrdersAt(
  db: Db,
  restaurantId: number,
  before: IsoDate,
  memberId?: number
): Promise<Map<number, { date: IsoDate; items: OrderItem[] }>> {
  const rows = await db
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.restaurantId, restaurantId),
        lt(orderItems.fridayDate, before),
        memberId === undefined ? undefined : eq(orderItems.memberId, memberId)
      )
    )
    .orderBy(desc(orderItems.fridayDate), asc(orderItems.id));
  const last = new Map<number, { date: IsoDate; items: OrderItem[] }>();
  for (const item of rows) {
    const entry = last.get(item.memberId);
    if (!entry) last.set(item.memberId, { date: item.fridayDate, items: [item] });
    else if (entry.date === item.fridayDate) entry.items.push(item);
  }
  return last;
}

/**
 * „gleiches“: orders again what someone had the last time they ate from this Friday's
 * restaurant. A dish that is gone from the menu, or whose options changed, is left out and
 * named. Null when they never ordered there.
 */
export async function orderSame(
  db: Db,
  date: IsoDate,
  memberId: number,
  restaurantId: number,
  now: Date
): Promise<{ date: IsoDate; ordered: string[]; gone: string[] } | null> {
  const last = (await lastOrdersAt(db, restaurantId, date, memberId)).get(memberId);
  if (!last) return null;
  // Lines of the same dish become one, or the second would pass for a double tap.
  const lines = new Map<string, OrderItem>();
  for (const item of last.items) {
    const key = [
      item.dishId,
      item.options.map((option) => `${option.groupId}:${option.choiceId}`).sort(),
      item.note,
    ].join('|');
    const same = lines.get(key);
    lines.set(key, same ? { ...same, quantity: same.quantity + item.quantity } : item);
  }
  const ordered: string[] = [];
  const gone: string[] = [];
  for (const item of lines.values()) {
    if (item.dishId === null) {
      gone.push(item.name);
      continue;
    }
    try {
      await addItem(
        db,
        date,
        memberId,
        {
          dishId: item.dishId,
          selection: selectionOf(item.options),
          note: item.note,
          quantity: item.quantity,
        },
        { now }
      );
      ordered.push(itemLabel(item));
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      gone.push(item.name);
    }
  }
  return { date: last.date, ordered, gone };
}
