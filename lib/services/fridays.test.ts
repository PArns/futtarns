import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { charges, orderItems } from '@/lib/db/schema';
import { parseOptionGroups } from '@/lib/menu/options';
import {
  hostedFridaysBetween,
  loadCalendar,
  loadFriday,
  lockDueFridays,
  lockFriday,
  openBalancesFor,
  recordPayment,
  setAttendance,
  setCancelled,
  setFlat,
  setHost,
  setRestaurant,
  settleFriday,
} from '@/lib/services/fridays';
import { addAbsence, addGuest, createMember } from '@/lib/services/members';
import { addItem, setDefaultDish, setNoFoodDefault } from '@/lib/services/orders';
import {
  createDish,
  createRestaurant,
  listDishes,
  setHostRestaurant,
} from '@/lib/services/restaurants';
import { createTestDb } from '@/test/db';

const FRIDAY = '2026-10-16';
const BEFORE = new Date('2026-10-16T12:00:00Z');
const AFTER = new Date('2026-10-16T17:05:00Z');

let db: Db;
let close: () => Promise<void>;

async function setup() {
  const patrick = (
    await createMember(db, { name: 'Patrick', isAdmin: true, isDefaultHost: true }, null)
  ).member;
  const anna = (await createMember(db, { name: 'Anna' }, patrick.id)).member;
  const ben = (await createMember(db, { name: 'Ben' }, patrick.id)).member;
  const clara = (await createMember(db, { name: 'Clara' }, patrick.id)).member;
  const pizzeria = await createRestaurant(db, {
    name: 'Pizzeria Test',
    cuisine: 'Pizza',
    lieferandoUrl: null,
    minOrderCents: 1500,
    deliveryFeeCents: 300,
    freeDeliveryFromCents: null,
    serviceFeeCents: 0,
    notes: null,
  });
  await createDish(db, pizzeria.id, {
    category: 'Pizza',
    name: 'Margherita',
    description: null,
    priceCents: 800,
    optionGroups: parseOptionGroups('Größe (1): Normal | Groß +2').groups,
  });
  await createDish(db, pizzeria.id, {
    category: 'Pizza',
    name: 'Salami',
    description: null,
    priceCents: 900,
    optionGroups: [],
  });
  const [margherita, salami] = await listDishes(db, pizzeria.id);
  await setRestaurant(db, FRIDAY, pizzeria.id);
  return { patrick, anna, ben, clara, pizzeria, margherita: margherita!, salami: salami! };
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

describe('a Friday', () => {
  it('uses the default host unless someone else is entered', async () => {
    const { patrick, anna } = await setup();
    expect((await loadFriday(db, FRIDAY, BEFORE)).host?.id).toBe(patrick.id);
    await setHost(db, FRIDAY, anna.id);
    const view = await loadFriday(db, FRIDAY, BEFORE);
    expect(view.host?.id).toBe(anna.id);
    expect(view.hostIsDefault).toBe(false);
  });

  it('gives silent members their default at the deadline, and nobody else', async () => {
    const { patrick, anna, ben, clara, pizzeria, margherita, salami } = await setup();
    await setDefaultDish(db, anna.id, pizzeria.id, {
      dishId: margherita.id,
      selection: { grosse: ['gross'] },
      note: 'scharf',
    });
    await setDefaultDish(db, ben.id, pizzeria.id, { dishId: salami.id, selection: {}, note: null });
    await setDefaultDish(db, clara.id, pizzeria.id, {
      dishId: salami.id,
      selection: {},
      note: null,
    });
    await setDefaultDish(db, patrick.id, pizzeria.id, {
      dishId: salami.id,
      selection: {},
      note: null,
    });
    await addItem(db, FRIDAY, patrick.id, {
      dishId: margherita.id,
      selection: { grosse: ['normal'] },
      note: null,
      quantity: 1,
    });
    await setAttendance(db, FRIDAY, ben.id, 'nofood');
    await addAbsence(db, clara.id, '2026-10-10', '2026-10-20', 'Urlaub');

    expect(await lockFriday(db, FRIDAY, BEFORE)).toBe(false);
    expect(await lockFriday(db, FRIDAY, AFTER)).toBe(true);
    expect(await lockFriday(db, FRIDAY, AFTER)).toBe(false);

    const view = await loadFriday(db, FRIDAY, AFTER);
    const byName = Object.fromEntries(view.participants.map((p) => [p.member.name, p]));
    expect(view.locked).toBe(true);
    expect(byName.Anna!.items).toMatchObject([
      { name: 'Margherita', unitPriceCents: 1000, isDefault: true, note: 'scharf' },
    ]);
    expect(byName.Patrick!.items).toMatchObject([{ name: 'Margherita', isDefault: false }]);
    expect(byName.Ben!.items).toEqual([]);
    expect(byName.Ben!.attendance.status).toBe('nofood');
    expect(byName.Clara!.items).toEqual([]);
    expect(byName.Clara!.attendance.reason).toBe('absent');
  });

  it('brings a silent member with a default of „nix“ along without food', async () => {
    const { anna, ben, pizzeria, margherita } = await setup();
    await setNoFoodDefault(db, anna.id, pizzeria.id);
    await setNoFoodDefault(db, ben.id, pizzeria.id);
    await addItem(db, FRIDAY, ben.id, {
      dishId: margherita.id,
      selection: { grosse: ['normal'] },
      note: null,
      quantity: 1,
    });

    const before = await loadFriday(db, FRIDAY, BEFORE);
    const anna0 = before.participants.find((p) => p.member.id === anna.id)!;
    expect(anna0.attendance.status).toBe('nofood');
    expect(anna0.projectedDefault).toBeNull();
    expect(before.participants.find((p) => p.member.id === ben.id)!.attendance.status).toBe('in');

    await lockFriday(db, FRIDAY, AFTER);
    const after = await loadFriday(db, FRIDAY, AFTER);
    const byName = Object.fromEntries(after.participants.map((p) => [p.member.name, p]));
    expect(byName.Anna!.items).toEqual([]);
    expect(byName.Anna!.share).toBeFalsy();
    expect(byName.Ben!.items).toMatchObject([{ name: 'Margherita', isDefault: false }]);
  });

  it('names the Fridays an absent host has to find someone for', async () => {
    const { patrick, anna } = await setup();
    await setHost(db, '2026-10-23', anna.id);
    await setCancelled(db, '2026-10-30', true, null);
    expect(await hostedFridaysBetween(db, patrick.id, '2026-10-14', '2026-11-08', BEFORE)).toEqual([
      '2026-10-16',
      '2026-11-06',
    ]);
    expect(await hostedFridaysBetween(db, patrick.id, '2026-10-01', '2026-10-10', BEFORE)).toEqual(
      []
    );

    expect((await loadFriday(db, FRIDAY, BEFORE)).hostAbsent).toBe(false);
    await addAbsence(db, patrick.id, '2026-10-14', '2026-10-18', 'Urlaub');
    expect((await loadFriday(db, FRIDAY, BEFORE)).hostAbsent).toBe(true);
    await setHost(db, FRIDAY, anna.id);
    expect((await loadFriday(db, FRIDAY, BEFORE)).hostAbsent).toBe(false);
  });

  it('orders from the host’s usual restaurant unless someone picks another', async () => {
    const { patrick, anna, pizzeria, margherita } = await setup();
    const sushi = await createRestaurant(db, {
      name: 'Sushi Test',
      cuisine: null,
      lieferandoUrl: null,
      minOrderCents: 0,
      deliveryFeeCents: 0,
      freeDeliveryFromCents: null,
      serviceFeeCents: 0,
      notes: null,
    });
    await setHostRestaurant(db, patrick.id, pizzeria.id);
    await setHostRestaurant(db, anna.id, sushi.id);
    const next = '2026-10-23';
    const later = '2026-10-30';
    await setHost(db, later, anna.id);

    const calendar = await loadCalendar(db, FRIDAY, 3);
    expect(calendar.map((entry) => [entry.restaurant?.name, entry.restaurantIsDefault])).toEqual([
      ['Pizzeria Test', false],
      ['Pizzeria Test', true],
      ['Sushi Test', true],
    ]);
    expect((await loadFriday(db, later, BEFORE)).restaurant?.id).toBe(sushi.id);

    // The first order pins Patrick's restaurant, so handing over the Friday keeps the menu.
    await addItem(db, next, anna.id, {
      dishId: margherita.id,
      selection: { grosse: ['normal'] },
      note: null,
      quantity: 1,
    });
    await setHost(db, next, anna.id);
    expect((await loadFriday(db, next, BEFORE)).restaurant?.id).toBe(pizzeria.id);

    // The lock writes the host's restaurant down for a Friday nobody ordered on. The clocks
    // went back by then, so 18:05Z is past the 19:00 deadline.
    await lockFriday(db, later, new Date('2026-10-30T18:05:00Z'));
    const locked = await loadFriday(db, later, new Date('2026-10-30T18:05:00Z'));
    expect(locked.restaurant?.id).toBe(sushi.id);
    expect(locked.restaurantIsDefault).toBe(false);
  });

  it('locks due Fridays from the timer, but not a cancelled one', async () => {
    await setup();
    expect(await lockDueFridays(db, BEFORE)).toEqual([]);
    expect(await lockDueFridays(db, AFTER)).toEqual([FRIDAY]);

    const next = '2026-10-23';
    await setCancelled(db, next, true, 'Feiertag');
    expect(await lockDueFridays(db, new Date('2026-10-23T17:05:00Z'))).toEqual([]);
    expect((await loadFriday(db, next, new Date('2026-10-23T17:05:00Z'))).locked).toBe(false);
  });

  it('drops orders when someone backs out or the restaurant changes', async () => {
    const { anna, ben, margherita } = await setup();
    await addItem(db, FRIDAY, anna.id, {
      dishId: margherita.id,
      selection: { grosse: ['normal'] },
      note: null,
      quantity: 2,
    });
    await addItem(db, FRIDAY, ben.id, {
      dishId: margherita.id,
      selection: { grosse: ['normal'] },
      note: null,
      quantity: 1,
    });
    await setAttendance(db, FRIDAY, anna.id, 'out');
    expect(await db.select().from(orderItems).where(eq(orderItems.memberId, anna.id))).toEqual([]);

    const other = await createRestaurant(db, {
      name: 'Sushi Test',
      cuisine: null,
      lieferandoUrl: null,
      minOrderCents: 0,
      deliveryFeeCents: 0,
      freeDeliveryFromCents: null,
      serviceFeeCents: 0,
      notes: null,
    });
    await setRestaurant(db, FRIDAY, other.id);
    expect(await db.select().from(orderItems)).toEqual([]);
  });

  it('rejects an option combination the dish does not allow', async () => {
    const { anna, margherita } = await setup();
    await expect(
      addItem(db, FRIDAY, anna.id, {
        dishId: margherita.id,
        selection: {},
        note: null,
        quantity: 1,
      })
    ).rejects.toThrow('Größe');
  });

  it('splits the real total and nets prepayments and drinks', async () => {
    const { patrick, anna, ben, clara, margherita, salami } = await setup();
    const guest = await addGuest(db, FRIDAY, 'Tim', anna.id);
    await addItem(db, FRIDAY, patrick.id, {
      dishId: salami.id,
      selection: {},
      note: null,
      quantity: 1,
    });
    await addItem(db, FRIDAY, anna.id, {
      dishId: margherita.id,
      selection: { grosse: ['gross'] },
      note: null,
      quantity: 1,
    });
    await addItem(db, FRIDAY, guest.id, {
      dishId: salami.id,
      selection: {},
      note: null,
      quantity: 1,
    });
    const dora = (await createMember(db, { name: 'Dora' }, null)).member;
    await setAttendance(db, FRIDAY, dora.id, 'out');

    // 2800 in dishes, 300 delivery, 250 tip: estimate 3350.
    const before = await loadFriday(db, FRIDAY, BEFORE);
    const moneyBefore = (id: number) => before.participants.find((p) => p.member.id === id)!.money;
    expect(moneyBefore(anna.id)).toEqual({
      foodCents: 1183,
      drinksCents: 150,
      dueCents: 1333,
      paidCents: 0,
      openCents: 1333,
    });
    expect(moneyBefore(ben.id).openCents).toBe(150);
    expect(moneyBefore(dora.id).openCents).toBe(0);
    await recordPayment(db, {
      date: FRIDAY,
      memberId: anna.id,
      amountCents: 1333,
      recordedById: anna.id,
    });

    await expect(settleFriday(db, FRIDAY, 3000, BEFORE)).rejects.toThrow('Bestellschluss');
    await lockFriday(db, FRIDAY, AFTER);
    // A voucher made it cheaper: 3000 instead of 3350, so Anna gets money back.
    await settleFriday(db, FRIDAY, 3000, AFTER);

    const stored = await db.select().from(charges);
    expect(stored.map((c) => [c.memberId, c.amountCents]).sort()).toEqual(
      [
        [patrick.id, 967],
        [anna.id, 1067],
        [guest.id, 966],
      ].sort()
    );
    const view = await loadFriday(db, FRIDAY, AFTER);
    const money = (id: number) => view.participants.find((p) => p.member.id === id)!.money;
    expect(money(patrick.id).openCents).toBe(0);
    expect(money(anna.id).openCents).toBe(1067 + 150 - 1333);
    expect(money(guest.id).openCents).toBe(966 + 150);
    expect(view.drinksTotalCents).toBe(4 * 150);
    expect(view.host?.id).toBe(patrick.id);

    const balances = await openBalancesFor(db, anna.id, '2026-10-23', AFTER);
    expect(balances.map((b) => [b.member.name, b.money.openCents])).toEqual([
      ['Anna', -116],
      ['Tim', 1116],
    ]);
    expect(clara.id).toBeGreaterThan(0);
  });

  it('counts the defaults of silent members in the estimate before the lock', async () => {
    const { anna, ben, pizzeria, margherita } = await setup();
    await setDefaultDish(db, ben.id, pizzeria.id, {
      dishId: margherita.id,
      selection: { grosse: ['normal'] },
      note: null,
    });
    await addItem(db, FRIDAY, anna.id, {
      dishId: margherita.id,
      selection: { grosse: ['normal'] },
      note: null,
      quantity: 1,
    });
    const view = await loadFriday(db, FRIDAY, BEFORE);
    const benEntry = view.participants.find((p) => p.member.id === ben.id)!;
    expect(benEntry.projectedDefault).toEqual({ name: 'Margherita', unitPriceCents: 800 });
    expect(view.estimate?.subtotalCents).toBe(1600);
    expect(benEntry.money.foodCents).toBeGreaterThan(800);
  });

  it('lets the host switch restaurant after the lock and hands out the new defaults', async () => {
    const { anna, ben, pizzeria } = await setup();
    const other = await createRestaurant(db, {
      name: 'Sushi Test',
      cuisine: null,
      lieferandoUrl: null,
      minOrderCents: 0,
      deliveryFeeCents: 0,
      freeDeliveryFromCents: null,
      serviceFeeCents: 99,
      notes: null,
    });
    await createDish(db, other.id, {
      category: null,
      name: 'Maki',
      description: null,
      priceCents: 700,
      optionGroups: [],
    });
    const [maki] = await listDishes(db, other.id);
    await setDefaultDish(db, ben.id, other.id, { dishId: maki!.id, selection: {}, note: null });
    await lockFriday(db, FRIDAY, AFTER);
    await setRestaurant(db, FRIDAY, other.id);
    const view = await loadFriday(db, FRIDAY, AFTER);
    expect(view.restaurant?.id).toBe(other.id);
    expect(view.participants.find((p) => p.member.id === ben.id)!.items).toMatchObject([
      { name: 'Maki', isDefault: true },
    ]);
    expect(view.participants.find((p) => p.member.id === anna.id)!.items).toEqual([]);
    expect(pizzeria.id).not.toBe(other.id);
  });

  it('owes nothing on a cancelled Friday and shows what was paid as a refund', async () => {
    const { anna } = await setup();
    await recordPayment(db, {
      date: FRIDAY,
      memberId: anna.id,
      amountCents: 500,
      recordedById: anna.id,
    });
    await setCancelled(db, FRIDAY, true, 'Krank');
    const view = await loadFriday(db, FRIDAY, AFTER);
    expect(view.participants.find((p) => p.member.id === anna.id)!.money.openCents).toBe(-500);
    expect(await openBalancesFor(db, anna.id, '2026-10-23', AFTER)).toMatchObject([
      { fridayDate: FRIDAY, title: 'abgesagt', money: { openCents: -500 } },
    ]);
  });

  it('charges a flat price only to those who said yes', async () => {
    const { patrick, anna, ben, clara } = await setup();
    const eva = (await createMember(db, { name: 'Eva' }, null)).member;
    await setFlat(db, FRIDAY, 'Grillen', 1500);
    await setAttendance(db, FRIDAY, anna.id, 'in');
    await setAttendance(db, FRIDAY, ben.id, 'nofood');
    await setAttendance(db, FRIDAY, clara.id, 'out');
    const view = await loadFriday(db, FRIDAY, AFTER);
    const open = (id: number) => view.participants.find((p) => p.member.id === id)!.money.openCents;
    expect(view.mode).toBe('flat');
    expect(view.restaurant).toBeNull();
    // Eva said nothing, and a barbecue needs a yes.
    expect([patrick.id, anna.id, ben.id, clara.id, eva.id].map(open)).toEqual([0, 1650, 150, 0, 0]);
    await expect(settleFriday(db, FRIDAY, 1000, AFTER)).rejects.toThrow('Pauschale');
  });

  it('reuses a guest who comes again', async () => {
    const { anna } = await setup();
    const first = await addGuest(db, FRIDAY, 'Tim', anna.id);
    const again = await addGuest(db, '2026-10-23', ' tim ', anna.id);
    expect(again.id).toBe(first.id);
  });
});
