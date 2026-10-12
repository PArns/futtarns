import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { OptionGroup, SelectedOption } from '@/lib/menu/options';

export type MemberKind = 'member' | 'guest';
/** `delivery`: everyone orders from a restaurant; `flat`: one price for everyone, e.g. a barbecue. */
export type FridayMode = 'delivery' | 'flat';

/** `nofood`: comes over but eats nothing, so gets no default dish and pays nothing. */
export type AttendanceStatus = 'in' | 'nofood' | 'out';

export const members = pgTable('members', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  // A guest has no login and only takes part in the Fridays they were added to.
  kind: text('kind').$type<MemberKind>().notNull().default('member'),
  // E.164 (`+491701234567`); logging in and WhatsApp both go through it.
  phone: text('phone').unique(),
  isAdmin: boolean('is_admin').notNull().default(false),
  isDefaultHost: boolean('is_default_host').notNull().default(false),
  paypalMe: text('paypal_me'),
  address: text('address'),
  loginTokenHash: text('login_token_hash').unique(),
  loginTokenExpiresAt: timestamp('login_token_expires_at', { withTimezone: true }),
  calendarToken: text('calendar_token').unique(),
  active: boolean('active').notNull().default(true),
  createdById: integer('created_by_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const absences = pgTable(
  'absences',
  {
    id: serial('id').primaryKey(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    note: text('note'),
  },
  (t) => [index('absences_member_idx').on(t.memberId)]
);

export const restaurants = pgTable('restaurants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  cuisine: text('cuisine'),
  lieferandoUrl: text('lieferando_url'),
  minOrderCents: integer('min_order_cents').notNull().default(0),
  deliveryFeeCents: integer('delivery_fee_cents').notNull().default(0),
  freeDeliveryFromCents: integer('free_delivery_from_cents'),
  // Lieferando's service fee per order.
  serviceFeeCents: integer('service_fee_cents').notNull().default(99),
  notes: text('notes'),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dishes = pgTable(
  'dishes',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    category: text('category'),
    name: text('name').notNull(),
    description: text('description'),
    priceCents: integer('price_cents').notNull(),
    optionGroups: jsonb('option_groups').$type<OptionGroup[]>().notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [index('dishes_restaurant_idx').on(t.restaurantId)]
);

export const fridays = pgTable('fridays', {
  date: date('date', { mode: 'string' }).primaryKey(),
  // null means the default host.
  hostId: integer('host_id').references(() => members.id, { onDelete: 'set null' }),
  cancelled: boolean('cancelled').notNull().default(false),
  cancelReason: text('cancel_reason'),
  mode: text('mode').$type<FridayMode>().notNull().default('delivery'),
  flatTitle: text('flat_title'),
  flatPriceCents: integer('flat_price_cents'),
  // null: 10 % of the dishes; otherwise the fixed tip the host chose.
  tipCents: integer('tip_cents'),
  // null: the default drinks flat fee; 0 switches it off for this Friday.
  drinksFeeCents: integer('drinks_fee_cents'),
  restaurantId: integer('restaurant_id').references(() => restaurants.id, {
    onDelete: 'set null',
  }),
  note: text('note'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  finalTotalCents: integer('final_total_cents'),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const attendance = pgTable(
  'attendance',
  {
    fridayDate: date('friday_date', { mode: 'string' }).notNull(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    status: text('status').$type<AttendanceStatus>().notNull(),
    addedById: integer('added_by_id').references(() => members.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fridayDate, t.memberId] })]
);

export const orderItems = pgTable(
  'order_items',
  {
    id: serial('id').primaryKey(),
    fridayDate: date('friday_date', { mode: 'string' }).notNull(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    dishId: integer('dish_id').references(() => dishes.id, { onDelete: 'set null' }),
    // Name and price are copied so a later menu edit cannot change a placed order.
    name: text('name').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    quantity: integer('quantity').notNull().default(1),
    options: jsonb('options').$type<SelectedOption[]>().notNull().default([]),
    note: text('note'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_items_friday_idx').on(t.fridayDate)]
);

export const memberDefaults = pgTable(
  'member_defaults',
  {
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    dishId: integer('dish_id')
      .notNull()
      .references(() => dishes.id, { onDelete: 'cascade' }),
    options: jsonb('options').$type<SelectedOption[]>().notNull().default([]),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.restaurantId] })]
);

export const charges = pgTable(
  'charges',
  {
    fridayDate: date('friday_date', { mode: 'string' }).notNull(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fridayDate, t.memberId] })]
);

/**
 * Money moving between a member and the host for one Friday: positive when the member
 * paid, negative when the host paid something back. Paying up front is the normal case,
 * so this is a ledger rather than a paid flag.
 */
export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    fridayDate: date('friday_date', { mode: 'string' }).notNull(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    recordedById: integer('recorded_by_id').references(() => members.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payments_friday_idx').on(t.fridayDate),
    index('payments_member_idx').on(t.memberId),
  ]
);

/** Who said no to the drinks flat fee on a Friday; everyone else who comes pays it. */
export const drinksOptOuts = pgTable(
  'drinks_opt_outs',
  {
    fridayDate: date('friday_date', { mode: 'string' }).notNull(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.fridayDate, t.memberId] })]
);

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_member_idx').on(t.memberId)]
);

export const loginCodes = pgTable(
  'login_codes',
  {
    id: serial('id').primaryKey(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_codes_member_idx').on(t.memberId)]
);

/** One row per message the scheduler sent, so a reminder goes out once however often it runs. */
export const notifications = pgTable('notifications', {
  key: text('key').primaryKey(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Member = typeof members.$inferSelect;
export type Absence = typeof absences.$inferSelect;
export type Restaurant = typeof restaurants.$inferSelect;
export type Dish = typeof dishes.$inferSelect;
export type Friday = typeof fridays.$inferSelect;
export type Attendance = typeof attendance.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type MemberDefault = typeof memberDefaults.$inferSelect;
export type Charge = typeof charges.$inferSelect;
export type Payment = typeof payments.$inferSelect;
