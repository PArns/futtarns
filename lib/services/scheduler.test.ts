import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/client';
import { recordPayment, setRestaurant, settleFriday } from '@/lib/services/fridays';
import { handleIncoming } from '@/lib/services/incoming';
import { createMember } from '@/lib/services/members';
import { addItem, setDefaultDish } from '@/lib/services/orders';
import { createDish, createRestaurant, listDishes } from '@/lib/services/restaurants';
import { runScheduler } from '@/lib/services/scheduler';
import { createTestDb } from '@/test/db';

const FRIDAY = '2026-10-16';
let db: Db;
let close: () => Promise<void>;
let sent: { to: string; text: string }[];
const send = async (to: string, text: string) => {
  sent.push({ to, text });
  return 'sent' as const;
};
const at = (iso: string) => new Date(iso);

async function setup() {
  const host = (
    await createMember(db, { name: 'Patrick', phone: '+491701111111', isDefaultHost: true }, null)
  ).member;
  const anna = (await createMember(db, { name: 'Anna', phone: '+491702222222' }, null)).member;
  const ben = (await createMember(db, { name: 'Ben', phone: '+491703333333' }, null)).member;
  const restaurant = await createRestaurant(db, {
    name: 'Bella Napoli',
    cuisine: null,
    lieferandoUrl: null,
    minOrderCents: 0,
    deliveryFeeCents: 300,
    freeDeliveryFromCents: null,
    serviceFeeCents: 0,
    notes: null,
  });
  await createDish(db, restaurant.id, {
    category: null,
    name: 'Margherita',
    description: null,
    priceCents: 900,
    optionGroups: [],
  });
  const [dish] = await listDishes(db, restaurant.id);
  await setRestaurant(db, FRIDAY, restaurant.id);
  return { host, anna, ben, restaurant, dish: dish! };
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  sent = [];
});

afterEach(async () => {
  await close();
});

describe('reminders', () => {
  it('invites on Wednesday once, and only those who have not answered', async () => {
    const { anna, dish } = await setup();
    await addItem(db, FRIDAY, anna.id, { dishId: dish.id, selection: {}, note: null, quantity: 1 });
    expect(await runScheduler(db, at('2026-10-14T09:00:00Z'), send)).toBe(0);
    await runScheduler(db, at('2026-10-14T10:05:00Z'), send);
    expect(sent.map((message) => message.to).sort()).toEqual(['+491701111111', '+491703333333']);
    expect(sent[0]!.text).toContain('Bella Napoli');
    await runScheduler(db, at('2026-10-14T10:06:00Z'), send);
    expect(sent).toHaveLength(2);
  });

  it('reminds people without an order on Friday afternoon and mentions their default', async () => {
    const { anna, ben, restaurant, dish } = await setup();
    await setDefaultDish(db, ben.id, restaurant.id, { dishId: dish.id, selection: {}, note: null });
    await addItem(db, FRIDAY, anna.id, { dishId: dish.id, selection: {}, note: null, quantity: 1 });
    await runScheduler(db, at('2026-10-16T15:05:00Z'), send);
    const order = sent.filter((message) => message.text.includes('noch nichts ausgesucht'));
    expect(order.map((message) => message.to)).toEqual(['+491703333333']);
    expect(order[0]!.text).toContain('Standard (Margherita)');
  });

  it('sends the host the order list at the deadline, and settled amounts afterwards', async () => {
    const { anna, dish } = await setup();
    await addItem(db, FRIDAY, anna.id, { dishId: dish.id, selection: {}, note: null, quantity: 2 });
    await runScheduler(db, at('2026-10-16T17:01:00Z'), send);
    const sheet = sent.find(
      (message) => message.to === '+491701111111' && message.text.startsWith('Bestellschluss')
    );
    expect(sheet?.text).toContain('2× Margherita – Anna');

    await recordPayment(db, {
      date: FRIDAY,
      memberId: anna.id,
      amountCents: 1000,
      purpose: 'food',
      recordedById: anna.id,
    });
    await settleFriday(db, FRIDAY, 2100, at('2026-10-16T17:40:00Z'));
    sent = [];
    await runScheduler(db, at('2026-10-16T17:45:00Z'), send);
    expect(sent).toEqual([
      expect.objectContaining({
        to: '+491702222222',
        text: expect.stringMatching(/11,00\s€ offen/),
      }),
    ]);

    sent = [];
    await runScheduler(db, at('2026-10-17T16:10:00Z'), send);
    expect(sent).toEqual([
      expect.objectContaining({
        to: '+491702222222',
        text: expect.stringContaining('Kleine Erinnerung'),
      }),
    ]);
    await runScheduler(db, at('2026-10-17T16:20:00Z'), send);
    expect(sent).toHaveLength(1);
  });

  it('understands WhatsApp replies', async () => {
    const { anna } = await setup();
    const now = at('2026-10-14T12:00:00Z');
    expect(await handleIncoming(db, '+491702222222', '3', now)).toContain('raus');
    expect(await handleIncoming(db, '+491702222222', 'Bin dabei!', now)).toContain('Bella Napoli');
    expect(await handleIncoming(db, '+491702222222', 'bezahlt', now)).toContain('nichts offen');
    expect(await handleIncoming(db, '+491702222222', 'code', now)).toMatch(
      /Dein Code für freitach: \d{6}/
    );
    expect(await handleIncoming(db, '+499999999', 'hallo', now)).toBeNull();
    expect(anna.id).toBeGreaterThan(0);
  });
});
