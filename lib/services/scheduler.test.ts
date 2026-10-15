import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/client';
import {
  castVote,
  loadFriday,
  recordPayment,
  setAttendance,
  setPickup,
  setRestaurant,
  settleFriday,
} from '@/lib/services/fridays';
import { handleIncoming } from '@/lib/services/incoming';
import { addAbsence, addGuestWithPhone, createMember } from '@/lib/services/members';
import { addItem, setDefaultDish, setNoFoodDefault } from '@/lib/services/orders';
import {
  createDish,
  createRestaurant,
  listDishes,
  setHostRestaurant,
  setRestaurantHosts,
  updateRestaurant,
} from '@/lib/services/restaurants';
import { openPayLink, payByLink } from '@/lib/services/pay-links';
import { runScheduler, upcomingMessages } from '@/lib/services/scheduler';
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
  it('asks on Wednesday and invites on Friday at ten, once, only those who have not answered', async () => {
    const { anna, dish } = await setup();
    await addItem(db, FRIDAY, anna.id, { dishId: dish.id, selection: {}, note: null, quantity: 1 });
    expect(await runScheduler(db, at('2026-10-14T09:55:00Z'), send, noPause)).toBe(0);
    await runScheduler(db, at('2026-10-14T10:05:00Z'), send, noPause);
    expect(sent.map((message) => message.to)).toEqual(['+491703333333']);
    expect(sent[0]!.text).toContain(
      'Übermorgen ist wieder Freitag, bei Patrick: *Diesmal bestellen wir bei Bella Napoli*'
    );
    expect(await runScheduler(db, at('2026-10-15T10:05:00Z'), send, noPause)).toBe(0);
    expect(await runScheduler(db, at('2026-10-16T07:55:00Z'), send, noPause)).toBe(0);
    sent = [];
    await runScheduler(db, at('2026-10-16T08:05:00Z'), send, noPause);
    expect(sent.map((message) => message.to)).toEqual(['+491703333333']);
    expect(sent[0]!.text).toContain('*Heute bestellen wir bei Bella Napoli*');
    await runScheduler(db, at('2026-10-16T08:06:00Z'), send, noPause);
    expect(sent).toHaveLength(1);
  });

  it('asks for an order at ten, in the invitation or on its own, but not twice', async () => {
    const { anna, ben, restaurant, dish } = await setup();
    await setDefaultDish(db, ben.id, restaurant.id, { dishId: dish.id, selection: {}, note: null });
    await setAttendance(db, FRIDAY, anna.id, 'in', at('2026-10-15T10:00:00Z'));
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

  it('does not remind whoever says yes after the reminder went out', async () => {
    await setup();
    // Anna answers on Friday afternoon; the bot's reply already asked her to pick something.
    const afternoon = at('2026-10-16T12:00:00Z');
    expect(await handleIncoming(db, '+491702222222', '1', afternoon, send)).toContain(
      'Jetzt noch bei *Bella Napoli* aussuchen'
    );
    sent = [];
    await runScheduler(db, at('2026-10-16T12:01:00Z'), send, noPause);
    expect(sent.filter((message) => message.to === '+491702222222')).toEqual([]);
    // She has no default, so the last call at 18:30 still reaches her.
    await runScheduler(db, at('2026-10-16T16:31:00Z'), send, noPause);
    expect(sent.find((message) => message.to === '+491702222222')?.text).toContain('Letzte Chance');
    // Ben says yes at 18:45: nothing but the bot's reply.
    sent = [];
    await handleIncoming(db, '+491703333333', '1', at('2026-10-16T16:45:00Z'), send);
    sent = [];
    await runScheduler(db, at('2026-10-16T16:46:00Z'), send, noPause);
    expect(sent.filter((message) => message.to === '+491703333333')).toEqual([]);
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
    // Change the last character for sure: a random token ends in `x` one time in 64.
    const forged = `${token!.slice(0, -1)}${token!.endsWith('x') ? 'y' : 'x'}`;
    expect(await payByLink(db, forged, at('2026-10-16T18:01:00Z'))).toBeNull();

    sent = [];
    await runScheduler(db, at('2026-10-17T16:10:00Z'), send, noPause);
    expect(sent.map((message) => message.to)).not.toContain('+491702222222');
  });

  it('reminds the host to pick a restaurant and tells everyone once it is chosen', async () => {
    const { restaurant } = await setup();
    await setRestaurant(db, FRIDAY, null);
    await runScheduler(db, at('2026-10-15T16:05:00Z'), send, noPause);
    await runScheduler(db, at('2026-10-16T07:05:00Z'), send, noPause);
    const toHost = sent.filter((message) => message.to === '+491701111111');
    expect(toHost).toHaveLength(2);
    expect(toHost.every((message) => message.text.includes('noch kein Restaurant'))).toBe(true);
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
    const invites = sent.filter((message) => message.text.startsWith('🎉'));
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

describe('upcoming messages', () => {
  const preview = async (now: Date) =>
    (await upcomingMessages(db, await loadFriday(db, FRIDAY, now), now)).map((line) => [
      line.at.toISOString(),
      line.kind,
      line.recipients.join(', '),
    ]);

  it('lists who hears what and when, and drops what went out', async () => {
    const { anna, ben, restaurant, dish } = await setup();
    await setDefaultDish(db, ben.id, restaurant.id, { dishId: dish.id, selection: {}, note: null });
    await setAttendance(db, FRIDAY, anna.id, 'in');
    expect((await preview(at('2026-10-12T08:00:00Z')))[0]).toEqual([
      '2026-10-14T10:00:00.000Z',
      'Kommst du?',
      'Ben',
    ]);
    await runScheduler(db, at('2026-10-14T10:05:00Z'), send, noPause);
    expect(await preview(at('2026-10-16T07:00:00Z'))).toEqual([
      ['2026-10-16T08:00:00.000Z', 'Einladung', 'Ben'],
      ['2026-10-16T08:00:00.000Z', 'Noch nichts ausgesucht', 'Anna'],
      ['2026-10-16T16:30:00.000Z', 'Letzte Chance', 'Anna'],
      ['2026-10-16T17:00:00.000Z', 'Betrag und Zahl-Link', 'Anna, Ben'],
      ['2026-10-16T17:00:00.000Z', 'Bestellliste', 'Patrick'],
    ]);

    await runScheduler(db, at('2026-10-16T08:05:00Z'), send, noPause);
    await addItem(db, FRIDAY, anna.id, { dishId: dish.id, selection: {}, note: null, quantity: 1 });
    expect(await preview(at('2026-10-16T08:10:00Z'))).toEqual([
      ['2026-10-16T17:00:00.000Z', 'Betrag und Zahl-Link', 'Anna, Ben'],
      ['2026-10-16T17:00:00.000Z', 'Bestellliste', 'Patrick'],
      ['2026-10-17T08:00:00.000Z', 'Was hat es gekostet?', 'Patrick'],
    ]);
  });

  it("shows what is due right away on the scheduler's next pass", async () => {
    await setup();
    await runScheduler(db, at('2026-10-16T08:05:00Z'), send, noPause);
    await createMember(db, { name: 'Carla', phone: '+491704444444' }, null);
    expect((await preview(at('2026-10-16T09:00:00Z')))[0]).toEqual([
      '2026-10-16T09:01:00.000Z',
      'Einladung',
      'Carla',
    ]);
  });
});

describe('fetching the food', () => {
  it('sends the list to whoever fetches it and splits the money between them and the host', async () => {
    const { host, anna, ben, restaurant, dish } = await setup();
    await updateRestaurant(db, restaurant.id, { pickup: true });
    await setPickup(db, FRIDAY, true, anna.id);
    for (const member of [host, anna, ben]) {
      await addItem(db, FRIDAY, member.id, {
        dishId: dish.id,
        selection: {},
        note: null,
        quantity: 1,
      });
    }

    const view = await loadFriday(db, FRIDAY, at('2026-10-16T12:00:00Z'));
    expect(view.estimate).toMatchObject({ deliveryFeeCents: 0, tipCents: 0, totalCents: 2700 });
    const ben0 = view.participants.find((entry) => entry.member.id === ben.id)!;
    expect(ben0.money.debts.map((debt) => [debt.payeeId, debt.openCents])).toEqual([
      [anna.id, 900],
      [host.id, 150],
    ]);

    await runScheduler(db, at('2026-10-16T17:01:00Z'), send, noPause);
    const sheet = sent.find((message) => message.text.includes('Zum Abholen'));
    expect(sheet?.to).toBe('+491702222222');
    expect(sheet?.text).toContain('*Bella Napoli*');
    const toBen = sent.find((message) => message.to === '+491703333333')!;
    expect(toBen.text).toContain('*9,00\u00a0€* fürs Essen an Anna');
    expect(toBen.text).toContain('*1,50\u00a0€* für die Getränke an Patrick');
    // The host pays their food to Anna, Anna her drinks to the host.
    expect(sent.find((message) => message.to === '+491701111111')?.text).toContain('9,00');
    expect(
      sent.find((message) => message.to === '+491702222222' && message.text.includes('/bezahlt/'))
        ?.text
    ).toContain('1,50');

    const token = toBen.text.match(/\/bezahlt\/(\S+)/)![1]!;
    expect(await payByLink(db, token, at('2026-10-16T17:30:00Z'))).toBe(1050);
    const after = await loadFriday(db, FRIDAY, at('2026-10-16T17:30:00Z'));
    expect(after.participants.find((entry) => entry.member.id === ben.id)!.money.openCents).toBe(0);
    await expect(setPickup(db, FRIDAY, false, null)).rejects.toThrow('schon bezahlt');

    // No real total to ask for; the payment reminders start the next evening.
    sent = [];
    await runScheduler(db, at('2026-10-17T08:05:00Z'), send, noPause);
    expect(sent).toEqual([]);
    await runScheduler(db, at('2026-10-17T16:05:00Z'), send, noPause);
    expect(sent.map((message) => message.to).sort()).toEqual(['+491701111111', '+491702222222']);
  });

  it('names who fetches it in the invitation', async () => {
    const { anna, restaurant } = await setup();
    await updateRestaurant(db, restaurant.id, { pickup: true });
    await setPickup(db, FRIDAY, true, anna.id);
    await runScheduler(db, at('2026-10-16T08:05:00Z'), send, noPause);
    expect(sent.find((message) => message.to === '+491703333333')?.text).toContain(
      'bestellen wir bei Bella Napoli (Anna holt ab)'
    );
  });
});

describe('the restaurant vote', () => {
  const NEXT = '2026-10-23';
  // Wednesday 12:05 and Friday 00:01, Berlin time.
  const WEDNESDAY = at('2026-10-21T10:05:00Z');
  const AFTER = at('2026-10-22T22:01:00Z');

  async function voteSetup() {
    const base = await setup();
    await setHostRestaurant(db, base.host.id, base.restaurant.id);
    const sushi = await createRestaurant(db, {
      name: 'Sakura Sushi',
      cuisine: 'Sushi',
      lieferandoUrl: 'https://www.lieferando.de/sakura',
      minOrderCents: 0,
      deliveryFeeCents: 0,
      freeDeliveryFromCents: null,
      serviceFeeCents: 99,
      notes: null,
    });
    return { ...base, sushi };
  }

  it('sends the ballot on Wednesday and lets the majority decide at midnight', async () => {
    const { anna, dish, sushi } = await voteSetup();
    await setAttendance(db, NEXT, anna.id, 'in');
    // An order placed before the vote goes when the restaurant changes.
    await addItem(db, NEXT, anna.id, { dishId: dish.id, selection: {}, note: null, quantity: 1 });

    await runScheduler(db, WEDNESDAY, send, noPause);
    const ask = sent.find((message) => message.to === '+491703333333')!;
    expect(ask.text).toContain('*Freunde des Freitagszocks!*');
    expect(ask.text).toContain('*A* · Bella Napoli 👑');
    expect(ask.text).toContain(
      '*B* · Sakura Sushi\nkein Mindestbestellwert · Lieferung gratis\nhttps://www.lieferando.de/sakura'
    );
    expect(ask.text).toContain('Und bist du überhaupt dabei?');
    // Anna already answered and the host is in anyway: they only get the ballot.
    const ballots = sent.filter((message) => !message.text.includes('überhaupt dabei'));
    expect(ballots.map((message) => message.to).sort()).toEqual(['+491701111111', '+491702222222']);

    expect(await handleIncoming(db, '+491703333333', 'b', WEDNESDAY, send)).toContain(
      'Stimme gezählt: *Sakura Sushi*'
    );
    await handleIncoming(db, '+491702222222', 'B', WEDNESDAY, send);
    await handleIncoming(db, '+491701111111', 'b', WEDNESDAY, send);
    // Changing one's mind replaces the vote.
    const reply = await handleIncoming(db, '+491701111111', 'a', WEDNESDAY, send);
    expect(reply).toContain('Sakura Sushi 2 (Ben, Anna)');
    expect(reply).toContain('Bella Napoli 1 (Patrick)');
    expect(await handleIncoming(db, '+491701111111', 'x', WEDNESDAY, send)).toContain(
      'Den Buchstaben gibt’s nicht'
    );

    const view = await loadFriday(db, NEXT, AFTER);
    expect(view.restaurant?.id).toBe(sushi.id);
    expect(view.participants.find((entry) => entry.member.id === anna.id)!.items).toEqual([]);
    expect(await handleIncoming(db, '+491703333333', 'a', AFTER, send)).toContain(
      "Freitag gibt's *Sakura Sushi*"
    );

    // Anna's order went with the old restaurant; she hears about it in the morning, not at night.
    sent = [];
    await runScheduler(db, AFTER, send, noPause);
    expect(sent.filter((message) => message.to === '+491702222222')).toEqual([]);
    await runScheduler(db, at('2026-10-23T07:05:00Z'), send, noPause);
    const repick = sent.find((message) => message.to === '+491702222222');
    expect(repick?.text).toContain("*Das Volk hat gewählt:* Heute gibt's *Sakura Sushi*!");
    sent = [];
    await runScheduler(db, at('2026-10-23T08:05:00Z'), send, noPause);
    expect(sent.filter((message) => message.to === '+491702222222')).toEqual([]);
  });

  it('does not send the ballot again to someone who answers the question it came with', async () => {
    await voteSetup();
    await runScheduler(db, WEDNESDAY, send, noPause);
    expect(sent.find((message) => message.to === '+491703333333')?.text).toContain(
      'Zur Wahl stehen'
    );
    await handleIncoming(db, '+491703333333', '1', WEDNESDAY, send);
    sent = [];
    await runScheduler(db, at('2026-10-21T10:10:00Z'), send, noPause);
    expect(sent.filter((message) => message.to === '+491703333333')).toEqual([]);
  });

  it('leaves the host alone on Thursday while the group votes, and asks no one on Friday morning', async () => {
    const { host } = await voteSetup();
    // No usual restaurant: the vote decides, or else the host on Friday morning.
    await setHostRestaurant(db, host.id, null);
    await runScheduler(db, WEDNESDAY, send, noPause);
    sent = [];
    await runScheduler(db, at('2026-10-22T16:05:00Z'), send, noPause);
    expect(sent.filter((message) => message.text.includes('kein Restaurant fest'))).toEqual([]);
    await runScheduler(db, at('2026-10-23T07:05:00Z'), send, noPause);
    expect(sent.find((message) => message.to === '+491701111111')?.text).toContain(
      'kein Restaurant fest'
    );

    // Someone new on Friday morning hears nothing until the invitation at ten.
    await createMember(db, { name: 'Carla', phone: '+491704444444' }, null);
    sent = [];
    await runScheduler(db, at('2026-10-23T07:30:00Z'), send, noPause);
    expect(sent.filter((message) => message.to === '+491704444444')).toEqual([]);
    await runScheduler(db, at('2026-10-23T08:05:00Z'), send, noPause);
    expect(sent.find((message) => message.to === '+491704444444')?.text).toContain(
      'Es ist Freitag, Carla!'
    );
  });

  it('does not promise a restaurant to someone who voted already', async () => {
    const { ben, sushi } = await voteSetup();
    await castVote(db, NEXT, ben.id, sushi.id, at('2026-10-20T10:00:00Z'));
    await runScheduler(db, WEDNESDAY, send, noPause);
    const ask = sent.find((message) => message.to === '+491703333333')!;
    expect(ask.text).toContain('Deine Stimme ist schon drin');
    expect(ask.text).not.toContain('Diesmal bestellen wir');
  });

  it('keeps the restaurant without votes or on a tie', async () => {
    const { restaurant } = await voteSetup();
    expect((await loadFriday(db, NEXT, AFTER)).restaurant?.id).toBe(restaurant.id);

    const next = '2026-10-30';
    const wednesday = at('2026-10-28T11:05:00Z');
    await handleIncoming(db, '+491702222222', 'b', wednesday, send);
    await handleIncoming(db, '+491703333333', 'a', wednesday, send);
    expect((await loadFriday(db, next, at('2026-10-29T23:01:00Z'))).restaurant?.id).toBe(
      restaurant.id
    );
  });

  it('lets a guest with a phone vote, but only on the Friday they were invited to', async () => {
    const { anna, restaurant } = await voteSetup();
    const { member: tim, loginToken } = await addGuestWithPhone(
      db,
      NEXT,
      { name: 'Tim', phone: '+491705555555' },
      anna.id
    );
    expect(tim.core).toBe(false);
    expect(loginToken).not.toBeNull();

    await runScheduler(db, WEDNESDAY, send, noPause);
    expect(sent.find((message) => message.to === '+491705555555')?.text).toContain(
      'Zur Wahl stehen'
    );
    expect(await handleIncoming(db, '+491705555555', 'b', WEDNESDAY, send)).toContain(
      'Stimme gezählt'
    );
    const view = await loadFriday(db, NEXT, WEDNESDAY);
    expect(view.participants.find((entry) => entry.member.id === tim.id)?.attendance).toEqual({
      status: 'in',
      reason: 'answered',
    });

    // A week later Tim is not part of it until someone invites him again.
    const later = at('2026-10-28T11:05:00Z');
    const nextWeek = await loadFriday(db, '2026-10-30', later);
    expect(nextWeek.participants.some((entry) => entry.member.id === tim.id)).toBe(false);
    await expect(castVote(db, '2026-10-30', tim.id, restaurant.id, later)).rejects.toThrow(
      'eingeladen'
    );
    // The same number brings back the same member, without a second invitation.
    const again = await addGuestWithPhone(
      db,
      '2026-10-30',
      { name: 'Timmy', phone: '+491705555555' },
      anna.id
    );
    expect([again.member.id, again.loginToken]).toEqual([tim.id, null]);
  });

  it('ends when the host picks a restaurant, and only offers what reaches the host', async () => {
    const { host, anna, restaurant, sushi } = await voteSetup();
    await setRestaurantHosts(db, sushi.id, [anna.id]);
    await runScheduler(db, WEDNESDAY, send, noPause);
    // Only one restaurant delivers to Patrick, so there is nothing to vote on.
    expect(sent.some((message) => message.text.includes('Zur Wahl stehen'))).toBe(false);

    await setRestaurantHosts(db, sushi.id, [host.id]);
    await setRestaurant(db, NEXT, restaurant.id);
    await expect(castVote(db, NEXT, anna.id, sushi.id, WEDNESDAY)).rejects.toThrow('vorbei');
  });

  async function sushiDish(sushiId: number) {
    await createDish(db, sushiId, {
      category: null,
      name: 'Maki Lachs',
      description: null,
      priceCents: 700,
      optionGroups: [],
    });
    return (await listDishes(db, sushiId))[0]!;
  }

  it('lets members order ahead from the restaurant they vote for, which stays if it wins', async () => {
    const { host, anna, ben, dish, sushi } = await voteSetup();
    const maki = await sushiDish(sushi.id);
    const choice = { dishId: maki.id, selection: {}, note: null, quantity: 1 };

    // Only from the restaurant one votes for; ordering from the ballot casts that vote.
    await expect(
      addItem(db, NEXT, anna.id, choice, { from: sushi.id, now: WEDNESDAY })
    ).rejects.toThrow('Vorbestellen geht nur beim Restaurant, das du gewählt hast');
    await addItem(db, NEXT, anna.id, choice, { from: sushi.id, vote: true, now: WEDNESDAY });
    // Ben hedges: a pizza in case it stays, sushi in case his vote wins.
    await addItem(db, NEXT, ben.id, { dishId: dish.id, selection: {}, note: null, quantity: 1 });
    await castVote(db, NEXT, ben.id, sushi.id, WEDNESDAY);
    await addItem(db, NEXT, ben.id, choice, { from: sushi.id, now: WEDNESDAY });
    await castVote(db, NEXT, host.id, sushi.id, WEDNESDAY);

    const during = await loadFriday(db, NEXT, WEDNESDAY);
    expect(during.votes).toContainEqual({ memberId: anna.id, restaurantId: sushi.id });
    const anna1 = during.participants.find((entry) => entry.member.id === anna.id)!;
    expect(anna1.items).toEqual([]);
    expect(anna1.attendance).toEqual({ status: 'in', reason: 'answered' });
    expect(during.preorders.map((item) => [item.memberId, item.name])).toEqual([
      [anna.id, 'Maki Lachs'],
      [ben.id, 'Maki Lachs'],
    ]);
    // Ordered ahead does not count towards this Friday's bill yet.
    expect(during.estimate?.subtotalCents).toBe(900);

    const view = await loadFriday(db, NEXT, AFTER);
    expect(view.restaurant?.id).toBe(sushi.id);
    const itemsOf = (id: number) =>
      view.participants.find((entry) => entry.member.id === id)!.items.map((item) => item.name);
    expect([itemsOf(anna.id), itemsOf(ben.id)]).toEqual([['Maki Lachs'], ['Maki Lachs']]);
    expect([view.preorders, view.voteDroppedIds]).toEqual([[], []]);

    // Nobody lost an order, so nobody is asked to pick again.
    await runScheduler(db, at('2026-10-23T07:05:00Z'), send, noPause);
    expect(sent.some((message) => message.text.includes('Das Volk hat gewählt'))).toBe(false);
  });

  it('drops what was ordered ahead when the vote changes or the restaurant stays', async () => {
    const { host, anna, ben, restaurant, sushi } = await voteSetup();
    const maki = await sushiDish(sushi.id);
    const choice = { dishId: maki.id, selection: {}, note: null, quantity: 1 };

    await addItem(db, NEXT, anna.id, choice, { from: sushi.id, vote: true, now: WEDNESDAY });
    expect(await castVote(db, NEXT, anna.id, restaurant.id, WEDNESDAY)).toBe(1);
    expect((await loadFriday(db, NEXT, WEDNESDAY)).preorders).toEqual([]);

    await addItem(db, NEXT, anna.id, choice, { from: sushi.id, vote: true, now: WEDNESDAY });
    expect(await handleIncoming(db, '+491702222222', 'a', WEDNESDAY, send)).toContain(
      'Vorbestellung beim anderen Restaurant ist damit raus'
    );
    await addItem(db, NEXT, anna.id, choice, { from: sushi.id, vote: true, now: WEDNESDAY });
    await castVote(db, NEXT, ben.id, restaurant.id, WEDNESDAY);
    await castVote(db, NEXT, host.id, restaurant.id, WEDNESDAY);

    // Bella Napoli stays; Anna's sushi goes and she is asked to pick again in the morning.
    const view = await loadFriday(db, NEXT, AFTER);
    expect(view.restaurant?.id).toBe(restaurant.id);
    expect([view.preorders, view.voteDroppedIds]).toEqual([[], [anna.id]]);
    await runScheduler(db, at('2026-10-23T07:05:00Z'), send, noPause);
    expect(sent.find((message) => message.to === '+491702222222')?.text).toContain(
      "*Das Volk hat gewählt:* Heute gibt's *Bella Napoli*!"
    );
  });

  it('keeps what was ordered ahead from the restaurant the host picks', async () => {
    const { anna, ben, dish, sushi } = await voteSetup();
    const maki = await sushiDish(sushi.id);
    await addItem(db, NEXT, ben.id, { dishId: dish.id, selection: {}, note: null, quantity: 1 });
    await addItem(
      db,
      NEXT,
      anna.id,
      { dishId: maki.id, selection: {}, note: null, quantity: 1 },
      { from: sushi.id, vote: true, now: WEDNESDAY }
    );
    await setRestaurant(db, NEXT, sushi.id);
    const view = await loadFriday(db, NEXT, WEDNESDAY);
    expect(
      view.participants.flatMap((entry) => entry.items.map((item) => [entry.member.id, item.name]))
    ).toEqual([[anna.id, 'Maki Lachs']]);
    expect(view.preorders).toEqual([]);
  });
});
