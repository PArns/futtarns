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
/** `nofood`: comes over but eats nothing, so gets no default dish and pays nothing. */
export type AttendanceStatus = 'in' | 'nofood' | 'out';

export const members = pgTable('members', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  // A guest has no login and only takes part in the Fridays they were added to.
  kind: text('kind').$type<MemberKind>().notNull().default('member'),
  phone: text('phone'),
  isAdmin: boolean('is_admin').notNull().default(false),
  isDefaultHost: boolean('is_default_host').notNull().default(false),
  paypalMe: text('paypal_me'),
  address: text('address'),
  loginTokenHash: text('login_token_hash').unique(),
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
  serviceFeeCents: integer('service_fee_cents').notNull().default(0),
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
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.fridayDate, t.memberId] })]
);

export type Member = typeof members.$inferSelect;
export type Absence = typeof absences.$inferSelect;
export type Restaurant = typeof restaurants.$inferSelect;
export type Dish = typeof dishes.$inferSelect;
export type Friday = typeof fridays.$inferSelect;
export type Attendance = typeof attendance.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type MemberDefault = typeof memberDefaults.$inferSelect;
export type Charge = typeof charges.$inferSelect;
