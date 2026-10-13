import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/client';
import { recordPayment, setAttendance, setRestaurant, settleFriday } from '@/lib/services/fridays';
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
  it('invites on Friday at ten, once, and only those who have not answered', async () => {
    const { anna, dish } = await setup();
    await addItem(db, FRIDAY, anna.id, { dishId: dish.id, selection: {}, note: null, quantity: 1 });
    expect(await runScheduler(db, at('2026-10-14T10:05:00Z'), send, noPause)).toBe(0);
    expect(await runScheduler(db, at('2026-10-16T07:55:00Z'), send, noPause)).toBe(0);
    await runScheduler(db, at('2026-10-16T08:05:00Z'), send, noPause);
    expect(sent.map((message) => message.to)).toEqual(['+491703333333']);
    expect(sent[0]!.text).toContain('*Heute bestellen wir bei Bella Napoli*');
    await runScheduler(db, at('2026-10-16T08:06:00Z'), send, noPause);
    expect(sent).toHaveLength(1);
  });

  it('asks for an order at ten, in the invitation or on its own, but not twice', async () => {
    const { anna, ben, restaurant, dish } = await setup();
    await setDefaultDish(db, ben.id, restaurant.id, { dishId: dish.id, selection: {}, note: null });
    await setAttendance(db, FRIDAY, anna.id, 'in');
    await runScheduler(db, at('2026-10-16T08:05:00Z'), send, noPause);
    const order = sent.filter((message) => message.text.includes('noch nichts ausgesucht'));
    expect(order.map((message) => message.to)).toEqual(['+491702222222']);
    const invite = sent.find((message) => message.to === '+491703333333');
    expect(invite?.text).toContain('Standard (*Margherita*)');

    // Ben says yes after the invitation, which already asked him to pick something.
    await setAttendance(db, FRIDAY, ben.id, 'in');
    sent = [];
    await runScheduler(db, at('2026-10-16T09:05:00Z'), send, noPause);
    expect(sent).toEqual([]);
  });

  it('does not remind someone whose default is „nix“ to order', async () => {
    const { anna, ben, restaurant } = await setup();
    await setNoFoodDefault(db, anna.id, restaurant.id);
    await setNoFoodDefault(db, ben.id, restaurant.id);
    await runScheduler(db, at('2026-10-16T08:05:00Z'), send, noPause);
    await runScheduler(db, at('2026-10-16T16:35:00Z'), send, noPause);
    expect(sent.filter((message) => message.text.includes('kannst du bei'))).toEqual([]);
  });

  it('sends the host the order list at the deadline, and settled amounts afterwards', async () => {
    const { anna, dish } = await setup();
    await addItem(db, FRIDAY, anna.id, { dishId: dish.id, selection: {}, note: null, quantity: 2 });
    // Nobody is asked to pay before the deadline; right after it everyone gets the link.
    await runScheduler(db, at('2026-10-16T16:55:00Z'), send, noPause);
    expect(sent.filter((message) => message.text.includes('paypal'))).toEqual([]);
    await runScheduler(db, at('2026-10-16T17:01:00Z'), send, noPause);
    const sheet = sent.find(
      (message) => message.to === '+491701111111' && message.text.includes('Bestellschluss!')
    );
    expect(sheet?.text).toContain('2× Margherita – Anna');
    expect(
      sent.filter((message) => message.text.includes('/bezahlt/')).map((message) => message.to)
    ).toEqual(['+491702222222', '+491703333333']);

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
    await runScheduler(db, at('2026-10-15T16:05:00Z'), send, noPause);
    await runScheduler(db, at('2026-10-16T07:05:00Z'), send, noPause);
    expect(sent.map((message) => message.to)).toEqual(['+491701111111', '+491701111111']);
    expect(sent.every((message) => message.text.includes('noch kein Restaurant'))).toBe(true);
    sent = [];
    await runScheduler(db, at('2026-10-16T08:05:00Z'), send, noPause);
    expect(sent.map((message) => message.to).sort()).toEqual(['+491702222222', '+491703333333']);
    expect(sent.every((message) => message.text.includes('Restaurant kommt noch'))).toBe(true);
    sent = [];
    await setRestaurant(db, FRIDAY, restaurant.id);
    await runScheduler(db, at('2026-10-16T08:10:00Z'), send, noPause);
    expect(sent.map((message) => message.to).sort()).toEqual(['+491702222222', '+491703333333']);
    expect(sent[0]!.text).toContain('steht es fest: *Bella Napoli*');
  });

  it('asks an absent host to find someone, and leaves the host out of the invitation', async () => {
    const { host } = await setup();
    await addAbsence(db, host.id, '2026-10-12', '2026-10-18', null);
    await runScheduler(db, at('2026-10-12T16:05:00Z'), send, noPause);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: '+491701111111' });
    expect(sent[0]!.text).toContain('wer übernimmt');
    await runScheduler(db, at('2026-10-16T08:05:00Z'), send, noPause);
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
    // Paying opens with the deadline.
    expect(await handleIncoming(db, '+491702222222', 'bezahlt', now, send)).toContain(
      'erst nach dem Bestellschluss'
    );
    expect(await handleIncoming(db, '+491702222222', 'code', now, send)).toBeNull();
    // The code stands bold on a line of its own, so it is easy to copy.
    expect(sent.at(-1)).toMatchObject({
      to: '+491702222222',
      text: expect.stringMatching(/Dein Code für freitach:\n\n\*\d{6}\*\n/),
    });
    expect(await handleIncoming(db, '+499999999', 'hallo', now, send)).toBeNull();
    // The bot may run on someone's own number, so ordinary chat from members stays unanswered.
    expect(await handleIncoming(db, '+491702222222', 'Kommst du heute?', now, send)).toBeNull();
    expect(await handleIncoming(db, '+491702222222', 'hilfe', now, send)).toContain(
      '*wie immer* – bin dabei, mit meinem Standardgericht'
    );

    const anna = (await handleIncoming(db, '+491702222222', 'status', now, send))!;
    expect(anna).toContain('Du bist dabei');
    await addItem(db, FRIDAY, 2, { dishId: dish.id, selection: {}, note: null, quantity: 1 });
    expect(await handleIncoming(db, '+491702222222', '3', now, send)).toContain('3 sicher');
    expect(await handleIncoming(db, '+491702222222', '3 sicher', now, send)).toContain('raus');
    await handleIncoming(db, '+491702222222', '1', now, send);
    // After the deadline (which also closes the Friday) „bezahlt“ books what is open.
    expect(
      await handleIncoming(db, '+491702222222', 'bezahlt', at('2026-10-16T17:30:00Z'), send)
    ).toMatch(/\*1,50\s€\* sind als bezahlt/);
  });

  it('orders the usual on „wie immer“ and lists what the others eat', async () => {
    const { anna, ben, restaurant, dish } = await setup();
    const now = at('2026-10-16T09:00:00Z');
    expect(await handleIncoming(db, '+491703333333', 'wie immer', now, send)).toContain(
      'noch keinen Standard'
    );
    await setDefaultDish(db, ben.id, restaurant.id, { dishId: dish.id, selection: {}, note: null });
    expect(await handleIncoming(db, '+491703333333', 'Wie immer!', now, send)).toContain(
      '*Margherita* wie immer'
    );
    expect(await handleIncoming(db, '+491703333333', 'wie immer', now, send)).toContain(
      'schon *Margherita* bestellt'
    );
    await setAttendance(db, FRIDAY, anna.id, 'nofood');
    const others = (await handleIncoming(db, '+491702222222', 'andere', now, send))!;
    expect(others).toContain('*Ben*: Margherita');
    expect(others).toContain('*Anna*: ohne Essen');
    expect(
      await handleIncoming(db, '+491703333333', 'wie immer', at('2026-10-16T17:30:00Z'), send)
    ).toContain('Bestellschluss war');
  });
});
