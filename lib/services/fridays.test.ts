import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { charges, orderItems } from '@/lib/db/schema';
import { parseOptionGroups } from '@/lib/menu/options';
import {
  loadFriday,
  lockDueFridays,
  lockFriday,
  openChargesFor,
  setAttendance,
  setCancelled,
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
  const patrick = (await createMember(db, { name: 'Patrick', isAdmin: true, isDefaultHost: true }, null)).member;
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
    await setDefaultDish(db, clara.id, pizzeria.id, { dishId: salami.id, selection: {}, note: null });
    await setDefaultDish(db, patrick.id, pizzeria.id, { dishId: salami.id, selection: {}, note: null });
    await addItem(db, FRIDAY, patrick.id, { dishId: margherita.id, selection: { grosse: ['normal'] }, note: null, quantity: 1 });
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
    await addItem(db, FRIDAY, anna.id, { dishId: margherita.id, selection: { grosse: ['normal'] }, note: null, quantity: 2 });
    await addItem(db, FRIDAY, ben.id, { dishId: margherita.id, selection: { grosse: ['normal'] }, note: null, quantity: 1 });
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
      addItem(db, FRIDAY, anna.id, { dishId: margherita.id, selection: {}, note: null, quantity: 1 })
    ).rejects.toThrow('Größe');
  });

  it('splits the real total and marks the host as paid', async () => {
    const { patrick, anna, margherita, salami } = await setup();
    const guest = await addGuest(db, FRIDAY, 'Tim', anna.id);
    await addItem(db, FRIDAY, patrick.id, { dishId: salami.id, selection: {}, note: null, quantity: 1 });
    await addItem(db, FRIDAY, anna.id, { dishId: margherita.id, selection: { grosse: ['gross'] }, note: null, quantity: 1 });
    await addItem(db, FRIDAY, guest.id, { dishId: salami.id, selection: {}, note: null, quantity: 1 });
    await setAttendance(db, FRIDAY, (await createMember(db, { name: 'Dora' }, null)).member.id, 'out');

    await expect(settleFriday(db, FRIDAY, 3100, BEFORE)).rejects.toThrow('Bestellschluss');
    await lockFriday(db, FRIDAY, AFTER);
    // 900 + 1000 + 900 = 2800 in dishes, 300 delivery split three ways.
    await settleFriday(db, FRIDAY, 3100, AFTER);

    const stored = await db.select().from(charges);
    expect(stored.map((c) => [c.memberId, c.amountCents, c.paidAt !== null]).sort()).toEqual(
      [
        [patrick.id, 1000, true],
        [anna.id, 1100, false],
        [guest.id, 1000, false],
      ].sort()
    );
    expect(await openChargesFor(db, anna.id)).toEqual([
      { fridayDate: FRIDAY, amountCents: 1100, payee: { id: patrick.id, name: 'Patrick', paypalMe: null } },
    ]);
    expect(await openChargesFor(db, patrick.id)).toEqual([]);
  });

  it('reuses a guest who comes again', async () => {
    const { anna } = await setup();
    const first = await addGuest(db, FRIDAY, 'Tim', anna.id);
    const again = await addGuest(db, '2026-10-23', ' tim ', anna.id);
    expect(again.id).toBe(first.id);
  });
});
