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
  type AnyPgColumn,
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
  // The „Gastgeber“ role: may hand any single Friday to another host.
  assignsHosts: boolean('assigns_hosts').notNull().default(false),
  // The „Stammtruppe“: asked every week and counted in when silent. A member outside it
  // has a login and a vote, but only for the Fridays someone added them to.
  core: boolean('core').notNull().default(true),
  paypalMe: text('paypal_me'),
  address: text('address'),
  // Where a Friday this member hosts orders from when nobody picks another restaurant.
  defaultRestaurantId: integer('default_restaurant_id').references(
    (): AnyPgColumn => restaurants.id,
    { onDelete: 'set null' }
  ),
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
  // The tip for its drivers, unless the host sets another amount for a Friday.
  tipCents: integer('tip_cents').notNull().default(250),
  // Whether we can also fetch the food ourselves, at the menu prices and without the fees.
  pickup: boolean('pickup').notNull().default(false),
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
    // Set when a member added the dish because it was missing from the menu.
    createdById: integer('created_by_id').references(() => members.id, { onDelete: 'set null' }),
  },
  (t) => [index('dishes_restaurant_idx').on(t.restaurantId)]
);

export const fridays = pgTable('fridays', {
  date: date('date', { mode: 'string' }).primaryKey(),
  // null means the default host.
  hostId: integer('host_id').references(() => members.id, { onDelete: 'set null' }),
  // An admin put this Friday at nobody's place: no host, not even the default one, until
  // someone of the group takes it over.
  noHost: boolean('no_host').notNull().default(false),
  cancelled: boolean('cancelled').notNull().default(false),
  cancelReason: text('cancel_reason'),
  mode: text('mode').$type<FridayMode>().notNull().default('delivery'),
  flatTitle: text('flat_title'),
  flatPriceCents: integer('flat_price_cents'),
  // null: the usual tip; otherwise what the host chose for this Friday.
  tipCents: integer('tip_cents'),
  // null: the default drinks flat fee; 0 switches it off for this Friday.
  drinksFeeCents: integer('drinks_fee_cents'),
  // A Lieferando voucher redeemed with this Friday's order, split like the fees.
  voucherCents: integer('voucher_cents'),
  // Someone fetches the food (if the restaurant offers it): no delivery fee, service fee or tip.
  pickup: boolean('pickup').notNull().default(false),
  // Who fetches it and so pays the restaurant and gets the food money; null means the host.
  pickerId: integer('picker_id').references(() => members.id, { onDelete: 'set null' }),
  restaurantId: integer('restaurant_id').references(() => restaurants.id, {
    onDelete: 'set null',
  }),
  // The host picked the restaurant themselves, which ends the vote; a first order only pins it.
  restaurantChosen: boolean('restaurant_chosen').notNull().default(false),
  // When the restaurant vote was counted (Friday at 16:00), so it is counted once.
  voteClosedAt: timestamp('vote_closed_at', { withTimezone: true }),
  // Whom the vote left without an order from the restaurant it decided on (their orders went,
  // their pick lost, or the restaurant changed); they are asked to pick once it is counted.
  voteDroppedIds: jsonb('vote_dropped_ids').$type<number[]>().notNull().default([]),
  note: text('note'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  finalTotalCents: integer('final_total_cents'),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  // When the host released paying; before it nobody pays, as the amounts may still change.
  paymentReleasedAt: timestamp('payment_released_at', { withTimezone: true }),
  // Whether the bot sends the payment links and reminders once paying is released.
  paymentNotify: boolean('payment_notify').notNull().default(false),
  // How often the host sent the payment links again, after prices changed.
  paymentRound: integer('payment_round').notNull().default(0),
  // What everyone owes in total by member id, as the payment links last told them, so a
  // correction only goes to whoever's amount changed since.
  paymentToldCents: jsonb('payment_told_cents')
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  // Whom the last correction (`paymentRound`) is for: their amount changed.
  paymentChangedIds: jsonb('payment_changed_ids').$type<number[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Who wants which restaurant for a Friday; one vote per member, changeable until the vote closes. */
export const restaurantVotes = pgTable(
  'restaurant_votes',
  {
    fridayDate: date('friday_date', { mode: 'string' }).notNull(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fridayDate, t.memberId] })]
);

/** The hosts a restaurant delivers to; a restaurant without any delivers to everyone. */
export const restaurantHosts = pgTable(
  'restaurant_hosts',
  {
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.restaurantId, t.memberId] })]
);

export const attendance = pgTable(
  'attendance',
  {
    fridayDate: date('friday_date', { mode: 'string' }).notNull(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    status: text('status').$type<AttendanceStatus>().notNull(),
    addedById: integer('added_by_id').references(() => members.id, { onDelete: 'set null' }),
    // Comes later than the food: their dish may be worth ordering later. `arrivesAt` is the
    // rough time (`21:00`), when they know it.
    late: boolean('late').notNull().default(false),
    arrivesAt: text('arrives_at'),
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
    // Where it is ordered from. Only the Friday's restaurant counts; during the vote a member
    // can order ahead from the one they voted for, which stays if it wins.
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    dishId: integer('dish_id').references(() => dishes.id, { onDelete: 'set null' }),
    // Name, category and price are copied so a later menu edit cannot change a placed order.
    name: text('name').notNull(),
    category: text('category'),
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
    // null: this member eats nothing from here unless they order, they just come along.
    dishId: integer('dish_id').references(() => dishes.id, { onDelete: 'cascade' }),
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
 * Money moving between a member and whoever they owe for one Friday: positive when the
 * member paid, negative when they got something back. Paying up front is the normal case,
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
    // Who got the money: the one who fetched the food, or null for the host.
    payeeId: integer('payee_id').references(() => members.id, { onDelete: 'set null' }),
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

/**
 * What Claude passed on to the admins from someone's WhatsApp message: its gist and the
 * message itself, so an admin can act on it by chat.
 */
export const adminNotes = pgTable(
  'admin_notes',
  {
    id: serial('id').primaryKey(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    note: text('note').notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('admin_notes_created_idx').on(t.createdAt)]
);

/** `in`: a member wrote to the bot; `out`: the bot wrote to them. */
export type ChatDirection = 'in' | 'out';

/**
 * What a chat message was: a fixed `command` or free `text` from the member; the bot's
 * `reply` to their message, or a `message` it sent on its own (a reminder, a nudge, news).
 */
export type ChatKind = 'command' | 'text' | 'reply' | 'message';

/**
 * The bot's WhatsApp chats with each member, kept for three months (`CHAT_DAYS`): Claude reads
 * the latest ones along with a new message, and admins read them through the MCP tools.
 * Login codes and links are blanked out before they are stored (`redactSecrets`).
 */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: serial('id').primaryKey(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    direction: text('direction').$type<ChatDirection>().notNull(),
    kind: text('kind').$type<ChatKind>().notNull(),
    // The command or Claude's action for what the member wrote; the key of what the bot sent.
    detail: text('detail'),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chat_messages_member_idx').on(t.memberId, t.createdAt),
    index('chat_messages_created_idx').on(t.createdAt),
  ]
);

/** A research tool Claude called while reading a message, with what it passed in. */
export type ToolCall = { name: string; input: unknown };

/**
 * Every time Claude read a member's message (`lib/services/readings.ts`): everything it was
 * given (the facts, the chat so far, the message), what it answered and looked up, what the
 * member got back, tokens, time and errors, under the version of the prompt it ran on. Kept
 * as long as the chats, so the prompt can be judged and improved on real messages, and a
 * reading replayed with a changed one. Admins rate readings while they look through them.
 */
export const assistantReadings = pgTable(
  'assistant_readings',
  {
    id: serial('id').primaryKey(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    // The member's message in their chat, while it is kept.
    chatMessageId: integer('chat_message_id').references(() => chatMessages.id, {
      onDelete: 'set null',
    }),
    message: text('message').notNull(),
    facts: text('facts').notNull(),
    chat: text('chat').notNull().default(''),
    model: text('model').notNull(),
    // Changes whenever the system prompt, the tools or the answer format change.
    promptVersion: text('prompt_version').notNull(),
    // Claude's answer as it came (`Interpretation`); null when there was none.
    interpretation: jsonb('interpretation').$type<Record<string, unknown>>(),
    action: text('action'),
    // The command the app ran from it, if any; Claude's action can be turned down.
    command: text('command'),
    // Everything the member got back: Claude's words, the command's result, the report.
    answer: text('answer'),
    toolCalls: jsonb('tool_calls').$type<ToolCall[]>().notNull().default([]),
    rounds: integer('rounds').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    // Why there was no usable answer (an error, a refusal, out of time); null when there was.
    error: text('error'),
    // An admin's verdict: 1 good, -1 bad, with what should have happened.
    rating: integer('rating'),
    ratingNote: text('rating_note'),
    ratedById: integer('rated_by_id').references(() => members.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assistant_readings_created_idx').on(t.createdAt),
    index('assistant_readings_chat_idx').on(t.chatMessageId),
  ]
);

/**
 * Personal keys for the MCP server (`/api/mcp`): whoever holds one acts as that member,
 * with that member's rights. Stored hashed, like sessions; shown once when made.
 */
export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    id: serial('id').primaryKey(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    // What the member called it, e.g. „Claude Desktop“, to tell their keys apart.
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('mcp_tokens_member_idx').on(t.memberId)]
);

/** Keys the app makes for itself on first use, such as the one that signs payment links. */
export const appSecrets = pgTable('app_secrets', {
  name: text('name').primaryKey(),
  value: text('value').notNull(),
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
export type AdminNote = typeof adminNotes.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type McpToken = typeof mcpTokens.$inferSelect;
export type AssistantReading = typeof assistantReadings.$inferSelect;
