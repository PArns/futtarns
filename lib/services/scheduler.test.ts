import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/client';
import { recordPayment, setRestaurant, settleFriday } from '@/lib/services/fridays';
import { handleIncoming } from '@/lib/services/incoming';
import { addAbsence, createMember } from '@/lib/services/members';
import { addItem, setDefaultDish, setNoFoodDefault } from '@/lib/services/orders';
import { createDish, createRestaurant, listDishes } from '@/lib/services/restaurants';
import { openPayLink, payByLink } from '@/lib/services/pay-links';
import { runScheduler } from '@/lib/services/scheduler';
import { createTestDb } from '@/test/db';

const FRIDAY = '2026-10-16';
let db: Db;
let close: () => Promise<void>;
let sent: { to: string; text: string; key?: string }[];
const send = async (to: string, text: string) => {
  sent.push({ to, text });
  return 'sent' as const;
};
const at = (iso: string) => new Date(iso);
const noPause = async () => {};

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
    expect(await runScheduler(db, at('2026-10-14T09:00:00Z'), send, noPause)).toBe(0);
    await runScheduler(db, at('2026-10-14T10:05:00Z'), send, noPause);
    expect(sent.map((message) => message.to)).toEqual(['+491703333333']);
    expect(sent[0]!.text).toContain('Bella Napoli');
    await runScheduler(db, at('2026-10-14T10:06:00Z'), send, noPause);
    expect(sent).toHaveLength(1);
  });

  it('reminds people without an order on Friday afternoon and mentions their default', async () => {
    const { anna, ben, restaurant, dish } = await setup();
    await setDefaultDish(db, ben.id, restaurant.id, { dishId: dish.id, selection: {}, note: null });
    await addItem(db, FRIDAY, anna.id, { dishId: dish.id, selection: {}, note: null, quantity: 1 });
    await runScheduler(db, at('2026-10-16T15:05:00Z'), send, noPause);
    const order = sent.filter((message) => message.text.includes('noch nichts ausgesucht'));
    expect(order.map((message) => message.to)).toEqual(['+491703333333']);
    expect(order[0]!.text).toContain('Standard (Margherita)');
  });

  it('does not remind someone whose default is „nix“ to order', async () => {
    const { anna, ben, restaurant } = await setup();
    await setNoFoodDefault(db, anna.id, restaurant.id);
    await setNoFoodDefault(db, ben.id, restaurant.id);
    await runScheduler(db, at('2026-10-16T15:05:00Z'), send, noPause);
    await runScheduler(db, at('2026-10-16T16:35:00Z'), send, noPause);
    expect(sent.filter((message) => message.text.includes('kannst du bei'))).toEqual([]);
  });

  it('sends the host the order list at the deadline, and settled amounts afterwards', async () => {
    const { anna, dish } = await setup();
    await addItem(db, FRIDAY, anna.id, { dishId: dish.id, selection: {}, note: null, quantity: 2 });
    await runScheduler(db, at('2026-10-16T17:01:00Z'), send, noPause);
    const sheet = sent.find(
      (message) => message.to === '+491701111111' && message.text.startsWith('Bestellschluss')
    );
    expect(sheet?.text).toContain('2× Margherita – Anna');

    await recordPayment(db, {
      date: FRIDAY,
      memberId: anna.id,
      amountCents: 1000,
      recordedById: anna.id,
    });
    // 1800 dishes, tip and delivery: 2100 in total; Anna also has the 1,50 € drinks fee.
    await settleFriday(db, FRIDAY, 2100, at('2026-10-16T17:40:00Z'));
    sent = [];
    await runScheduler(db, at('2026-10-16T17:45:00Z'), send, noPause);
    expect(sent.map((message) => [message.to, message.text.match(/\d+,\d+\s€/)?.[0]])).toEqual([
      ['+491702222222', '12,50\u00a0€'],
      ['+491703333333', '1,50\u00a0€'],
    ]);

    sent = [];
    await runScheduler(db, at('2026-10-17T16:10:00Z'), send, noPause);
    expect(sent.map((message) => message.to)).toEqual(['+491702222222', '+491703333333']);
    expect(sent[0]!.text).toContain('Kleine Erinnerung');
    await runScheduler(db, at('2026-10-17T16:20:00Z'), send, noPause);
    expect(sent).toHaveLength(2);
  });

  it('stops the payment reminders once the link in one is used', async () => {
    const { anna, dish } = await setup();
    await addItem(db, FRIDAY, anna.id, { dishId: dish.id, selection: {}, note: null, quantity: 1 });
    await runScheduler(db, at('2026-10-16T17:01:00Z'), send, noPause);
    await settleFriday(db, FRIDAY, 1200, at('2026-10-16T17:40:00Z'));
    sent = [];
    await runScheduler(db, at('2026-10-16T17:45:00Z'), send, noPause);
    const settled = sent.find((message) => message.to === '+491702222222');
    const token = settled?.text.match(/\/bezahlt\/(\S+)/)?.[1];
    expect(token).toBeDefined();

    // Opening the link (as a chat preview does) changes nothing; only the button books.
    expect((await openPayLink(db, token!, at('2026-10-16T18:00:00Z')))?.entry.member.id).toBe(
      anna.id
    );
    expect(await payByLink(db, token!, at('2026-10-16T18:00:00Z'))).toBeGreaterThan(0);
    expect(await payByLink(db, token!, at('2026-10-16T18:01:00Z'))).toBe(0);
    expect(await payByLink(db, `${token!.slice(0, -1)}x`, at('2026-10-16T18:01:00Z'))).toBeNull();

    sent = [];
    await runScheduler(db, at('2026-10-17T16:10:00Z'), send, noPause);
    expect(sent.map((message) => message.to)).not.toContain('+491702222222');
  });

  it('reminds the host to pick a restaurant and tells everyone once it is chosen', async () => {
    const { restaurant } = await setup();
    await setRestaurant(db, FRIDAY, null);
    await runScheduler(db, at('2026-10-14T10:05:00Z'), send, noPause);
    expect(sent).toEqual([]);
    await runScheduler(db, at('2026-10-15T10:05:00Z'), send, noPause);
    expect(sent.map((message) => message.key ?? message.to).length).toBe(2);
    expect(sent.every((message) => message.text.includes('Restaurant kommt noch'))).toBe(true);
    await runScheduler(db, at('2026-10-15T16:05:00Z'), send, noPause);
    expect(sent.at(-1)).toMatchObject({
      to: '+491701111111',
      text: expect.stringContaining('noch kein Restaurant'),
    });
    sent = [];
    await setRestaurant(db, FRIDAY, restaurant.id);
    await runScheduler(db, at('2026-10-15T16:10:00Z'), send, noPause);
    expect(sent.map((message) => message.to).sort()).toEqual(['+491702222222', '+491703333333']);
    expect(sent[0]!.text).toContain('steht es fest: Bella Napoli');
  });

  it('asks an absent host to find someone, and leaves the host out of the invitation', async () => {
    const { host } = await setup();
    await addAbsence(db, host.id, '2026-10-12', '2026-10-18', null);
    await runScheduler(db, at('2026-10-12T16:05:00Z'), send, noPause);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: '+491701111111' });
    expect(sent[0]!.text).toContain('wer übernimmt');
    await runScheduler(db, at('2026-10-14T10:05:00Z'), send, noPause);
    const invites = sent.filter((message) => message.text.startsWith('Hi '));
    expect(invites).toHaveLength(2);
    expect(invites[0]!.text).toContain('wo, klären wir noch');
    expect(invites[0]!.text).not.toContain('bei Patrick');
  });

  it('understands WhatsApp replies', async () => {
    const { dish } = await setup();
    const now = at('2026-10-14T12:00:00Z');
    expect(await handleIncoming(db, '+491702222222', '3', now, send)).toContain('raus');
    expect(await handleIncoming(db, '+491702222222', 'Bin dabei!', now, send)).toContain(
      'Bella Napoli'
    );
    expect(await handleIncoming(db, '+491702222222', 'bezahlt', now, send)).toMatch(
      /1,50\s€ sind als bezahlt/
    );
    expect(await handleIncoming(db, '+491702222222', 'code', now, send)).toBeNull();
    expect(sent.at(-1)).toMatchObject({
      to: '+491702222222',
      text: expect.stringMatching(/Dein Code für freitach: \d{6}/),
    });
    expect(await handleIncoming(db, '+499999999', 'hallo', now, send)).toBeNull();
    // The bot may run on someone's own number, so ordinary chat from members stays unanswered.
    expect(await handleIncoming(db, '+491702222222', 'Kommst du heute?', now, send)).toBeNull();
    expect(await handleIncoming(db, '+491702222222', 'hilfe', now, send)).toContain(
      '1 – bin dabei'
    );

    const anna = (await handleIncoming(db, '+491702222222', 'status', now, send))!;
    expect(anna).toContain('Du bist dabei');
    await addItem(db, FRIDAY, 2, { dishId: dish.id, selection: {}, note: null, quantity: 1 });
    expect(await handleIncoming(db, '+491702222222', '3', now, send)).toContain('3 sicher');
    expect(await handleIncoming(db, '+491702222222', '3 sicher', now, send)).toContain('raus');
  });
});
