/**
 * Fills a local database with a believable group for development and screenshots.
 * Refuses to touch a database that already has members.
 */
import { loginLink } from '@/lib/auth-tokens';
import { addWeeks, currentFriday, orderDeadline } from '@/lib/dates';
import { migrateDb, openDb } from '@/lib/db/client';
import { members } from '@/lib/db/schema';
import { parseOptionGroups } from '@/lib/menu/options';
import {
  loadFriday,
  lockFriday,
  recordPayment,
  setDrinksOptOut,
  setAttendance,
  setCancelled,
  setFlat,
  setFridayNote,
  setHost,
  setRestaurant,
  settleFriday,
} from '@/lib/services/fridays';
import { addAbsence, addGuest, createMember, updateProfile } from '@/lib/services/members';
import { addItem, setDefaultDish } from '@/lib/services/orders';
import {
  createDish,
  createRestaurant,
  listDishes,
  setHostRestaurant,
} from '@/lib/services/restaurants';

const url = process.env.DATABASE_URL || '.data/pglite';
const { db, close } = await openDb(url);
await migrateDb(db, url);
if ((await db.select().from(members).limit(1)).length > 0) {
  console.error('The database already has members; seed only runs on an empty one.');
  process.exit(1);
}

const people = {} as Record<string, { id: number; token: string }>;
for (const [name, phone, extra] of [
  ['Patrick', '+491701111111', { isAdmin: true, isDefaultHost: true }],
  ['Anna', '+491702222222', {}],
  ['Ben', '+491703333333', {}],
  ['Clara', '+491704444444', {}],
  ['David', '+491705555555', {}],
  ['Eva', '+491706666666', {}],
  ['Felix', '+491707777777', {}],
] as const) {
  const { member, loginToken } = await createMember(db, { name, phone, ...extra }, null);
  people[name] = { id: member.id, token: loginToken };
}
const id = (name: string) => people[name]!.id;
await updateProfile(db, id('Patrick'), {
  paypalMe: 'freitach-demo',
  address: 'Musterstraße 12\n45127 Essen',
});
await updateProfile(db, id('Anna'), {
  paypalMe: 'anna-demo',
  address: 'Rüttenscheider Str. 5\n45128 Essen',
});

const pizzeria = await createRestaurant(db, {
  name: 'Bella Napoli',
  cuisine: 'Pizza & Pasta',
  lieferandoUrl: 'https://www.lieferando.de/speisekarte/bella-napoli-beispiel',
  minOrderCents: 1500,
  deliveryFeeCents: 299,
  freeDeliveryFromCents: 6000,
  serviceFeeCents: 99,
  notes: 'Pizza immer gut durch bestellen.',
  pickup: true,
});
await setHostRestaurant(db, id('Patrick'), pizzeria.id);
const size = 'Größe (1): Normal 28 cm | Groß 32 cm +2,50';
const extras =
  'Extras (0-4): Extra Käse +1,00 | Salami +1,50 | Champignons +1,00 | Jalapeños +0,80 | Rucola +1,00';
for (const [category, name, description, price, options] of [
  ['Pizza', 'Margherita', 'Tomatensauce, Mozzarella, Basilikum', 850, `${size}\n${extras}`],
  ['Pizza', 'Salami', 'Tomatensauce, Mozzarella, Rindersalami', 950, `${size}\n${extras}`],
  ['Pizza', 'Funghi', 'Tomatensauce, Mozzarella, frische Champignons', 950, `${size}\n${extras}`],
  ['Pizza', 'Diavolo', 'scharfe Salami, Peperoni, Zwiebeln', 1090, `${size}\n${extras}`],
  ['Pizza', 'Tonno', 'Thunfisch, rote Zwiebeln, Kapern', 1050, `${size}\n${extras}`],
  ['Pasta', 'Spaghetti Carbonara', 'Speck, Ei, Parmesan', 1150, ''],
  [
    'Pasta',
    'Penne all’Arrabbiata',
    'scharfe Tomatensauce, Knoblauch',
    990,
    'Käse (0-1): Parmesan +0,80',
  ],
  ['Pasta', 'Lasagne al Forno', 'hausgemacht', 1290, ''],
  [
    'Salate',
    'Insalata Mista',
    'gemischter Salat, Hausdressing',
    790,
    'Dressing (1): Balsamico | Joghurt | Ohne',
  ],
  ['Getränke', 'Cola 1,0 l', null, 350, ''],
  ['Desserts', 'Tiramisu', 'nach Art des Hauses', 590, ''],
] as const) {
  await createDish(db, pizzeria.id, {
    category,
    name,
    description,
    priceCents: price,
    optionGroups: parseOptionGroups(options).groups,
  });
}
const burger = await createRestaurant(db, {
  name: 'Smash Bros. Burger',
  cuisine: 'Burger',
  lieferandoUrl: null,
  minOrderCents: 2000,
  deliveryFeeCents: 390,
  freeDeliveryFromCents: null,
  serviceFeeCents: 99,
  notes: null,
});
for (const [category, name, price] of [
  ['Burger', 'Classic Smash', 990],
  ['Burger', 'Double Cheese', 1290],
  ['Burger', 'Veggie Smash', 1090],
  ['Beilagen', 'Pommes', 390],
  ['Beilagen', 'Süßkartoffelpommes', 490],
] as const) {
  await createDish(db, burger.id, {
    category,
    name,
    description: null,
    priceCents: price,
    optionGroups: [],
  });
}
await setHostRestaurant(db, id('Anna'), burger.id);
await createRestaurant(db, {
  name: 'Sakura Sushi',
  cuisine: 'Sushi',
  lieferandoUrl: null,
  minOrderCents: 2500,
  deliveryFeeCents: 250,
  freeDeliveryFromCents: 5000,
  serviceFeeCents: 99,
  notes: null,
});

const dishes = await listDishes(db, pizzeria.id);
const dish = (name: string) => dishes.find((entry) => entry.name === name)!.id;
await setDefaultDish(db, id('Anna'), pizzeria.id, {
  dishId: dish('Margherita'),
  selection: { grosse: ['normal-28-cm'] },
  note: null,
});
await setDefaultDish(db, id('David'), pizzeria.id, {
  dishId: dish('Diavolo'),
  selection: { grosse: ['gross-32-cm'] },
  note: 'extra scharf',
});
await setDefaultDish(db, id('Felix'), pizzeria.id, {
  dishId: dish('Salami'),
  selection: { grosse: ['normal-28-cm'] },
  note: null,
});

const now = new Date();
const thisWeek = currentFriday(now);

// Last week: ordered, settled, Ben still owes.
const lastWeek = addWeeks(thisWeek, -1);
await setRestaurant(db, lastWeek, burger.id);
const burgers = await listDishes(db, burger.id);
for (const [name, dishName] of [
  ['Patrick', 'Double Cheese'],
  ['Ben', 'Classic Smash'],
  ['Clara', 'Veggie Smash'],
  ['Eva', 'Classic Smash'],
] as const) {
  await addItem(db, lastWeek, id(name), {
    dishId: burgers.find((entry) => entry.name === dishName)!.id,
    selection: {},
    note: null,
    quantity: 1,
  });
}
for (const name of ['Anna', 'David', 'Felix']) await setAttendance(db, lastWeek, id(name), 'out');
const afterLastWeek = new Date(orderDeadline(lastWeek).getTime() + 3_600_000);
await lockFriday(db, lastWeek, afterLastWeek);
await settleFriday(db, lastWeek, 5170, afterLastWeek);
async function payInFull(date: string, name: string) {
  const view = await loadFriday(db, date, new Date());
  const open = view.participants.find((entry) => entry.member.id === id(name))!.money.openCents;
  await recordPayment(db, { date, memberId: id(name), amountCents: open, recordedById: id(name) });
}
await payInFull(lastWeek, 'Clara');
await payInFull(lastWeek, 'Eva');

// This week: pizza, half the group has ordered, one guest; paying opens at the deadline.
await setRestaurant(db, thisWeek, pizzeria.id);
await setFridayNote(db, thisWeek, 'Bringt gute Laune mit – Getränke sind da.');
await addItem(db, thisWeek, id('Patrick'), {
  dishId: dish('Diavolo'),
  selection: { grosse: ['gross-32-cm'], extras: ['extra-kase'] },
  note: null,
  quantity: 1,
});
await addItem(db, thisWeek, id('Anna'), {
  dishId: dish('Margherita'),
  selection: { grosse: ['normal-28-cm'], extras: ['rucola'] },
  note: null,
  quantity: 1,
});
await addItem(db, thisWeek, id('Clara'), {
  dishId: dish('Penne all’Arrabbiata'),
  selection: { kase: ['parmesan'] },
  note: null,
  quantity: 1,
});
await addItem(db, thisWeek, id('Clara'), {
  dishId: dish('Tiramisu'),
  selection: {},
  note: null,
  quantity: 1,
});
await setAttendance(db, thisWeek, id('Eva'), 'nofood');
const guest = await addGuest(db, thisWeek, 'Tim', id('Anna'));
await addItem(db, thisWeek, guest.id, {
  dishId: dish('Salami'),
  selection: { grosse: ['normal-28-cm'] },
  note: 'ohne Zwiebeln',
  quantity: 1,
});
await setDrinksOptOut(db, thisWeek, id('Felix'), true);
await addAbsence(db, id('Ben'), thisWeek, addWeeks(thisWeek, 1), 'Urlaub');

// Next week Anna hosts a barbecue; the week after is off.
const nextWeek = addWeeks(thisWeek, 1);
await setHost(db, nextWeek, id('Anna'));
await setFlat(db, nextWeek, 'Grillen bei Anna', 1500);
await setCancelled(db, addWeeks(thisWeek, 2), true, 'Patrick ist im Urlaub');
// Anna stands in a week later and orders from her usual place; the week after that
// Patrick is away and nobody has taken over yet.
await setHost(db, addWeeks(thisWeek, 3), id('Anna'));
await addAbsence(db, id('Patrick'), addWeeks(thisWeek, 4), addWeeks(thisWeek, 4), 'Hochzeit');

console.log('Seeded. Login links:');
for (const name of ['Patrick', 'Anna', 'Ben'])
  console.log(`  ${name}: ${loginLink(people[name]!.token)}`);
await close();
