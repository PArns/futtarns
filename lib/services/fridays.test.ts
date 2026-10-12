import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { charges, orderItems } from '@/lib/db/schema';
import { parseOptionGroups } from '@/lib/menu/options';
import {
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
import { addItem, setDefaultDish } from '@/lib/services/orders';
import { createDish, createRestaurant, listDishes } from '@/lib/services/restaurants';
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

  it('splits the real total, tip by order size, and nets prepayments and drinks', async () => {
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

    // 2800 in dishes, 300 delivery, 10 % tip rounded to 300: estimate 3400.
    const before = await loadFriday(db, FRIDAY, BEFORE);
    const moneyBefore = (id: number) => before.participants.find((p) => p.member.id === id)!.money;
    expect(moneyBefore(anna.id)).toEqual({
      foodCents: 1207,
      drinksCents: 150,
      dueCents: 1357,
      paidCents: 0,
      openCents: 1357,
    });
    expect(moneyBefore(ben.id).openCents).toBe(150);
    expect(moneyBefore(dora.id).openCents).toBe(0);
    await recordPayment(db, {
      date: FRIDAY,
      memberId: anna.id,
      amountCents: 1357,
      recordedById: anna.id,
    });

    await expect(settleFriday(db, FRIDAY, 3000, BEFORE)).rejects.toThrow('Bestellschluss');
    await lockFriday(db, FRIDAY, AFTER);
    // A voucher made it cheaper: 3000 instead of 3400, so Anna gets money back.
    await settleFriday(db, FRIDAY, 3000, AFTER);

    const stored = await db.select().from(charges);
    expect(stored.map((c) => [c.memberId, c.amountCents]).sort()).toEqual(
      [
        [patrick.id, 964],
        [anna.id, 1074],
        [guest.id, 962],
      ].sort()
    );
    const view = await loadFriday(db, FRIDAY, AFTER);
    const money = (id: number) => view.participants.find((p) => p.member.id === id)!.money;
    expect(money(patrick.id).openCents).toBe(0);
    expect(money(anna.id).openCents).toBe(1074 + 150 - 1357);
    expect(money(guest.id).openCents).toBe(962 + 150);
    expect(view.drinksTotalCents).toBe(4 * 150);
    expect(view.host?.id).toBe(patrick.id);

    const balances = await openBalancesFor(db, anna.id, '2026-10-23', AFTER);
    expect(balances.map((b) => [b.member.name, b.money.openCents])).toEqual([
      ['Anna', -133],
      ['Tim', 1112],
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
