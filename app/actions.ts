'use server';

import { and, eq } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import type { MenuDish } from '@/components/friday/dish-dialog';
import { appUrl, loginLink } from '@/lib/auth-tokens';
import { isFridayIso, isIsoDate, isPastDeadline, type IsoDate } from '@/lib/dates';
import { getDb } from '@/lib/db';
import { attendance, members, type Member } from '@/lib/db/schema';
import { formatDayList, formatDayShort } from '@/lib/format';
import { parseEuroToCents, parseOptionGroups } from '@/lib/menu/options';
import { normalizePaypalHandle } from '@/lib/paypal';
import { normalizePhone } from '@/lib/phone';
import { guestInviteText, guestWelcomeText, welcomeText } from '@/lib/welcome';
import { botState, relinkBot, whatsappConfigured, sendWhatsApp } from '@/lib/whatsapp';

// Validation messages reach the toast as they are, and the app speaks German.
z.config(z.locales.de());
import { canEditOrderOf, canManageFriday, canSetHost } from '@/lib/permissions';
import { getGroupContext, SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';
import {
  createSession,
  deleteSession,
  requestLoginCode,
  verifyLoginCode,
} from '@/lib/services/auth';
import {
  bookOpen,
  castVote,
  clearPayments,
  currentRestaurantId,
  getFridayRow,
  hostedFridaysBetween,
  hostIdFor,
  loadFriday,
  paymentOpen,
  reopenSettlement,
  setAttendance,
  setCancelled,
  setDrinksFee,
  setDrinksOptOut,
  setFlat,
  setFridayNote,
  setHost,
  setPickup,
  setRestaurant,
  setTip,
  setVoucher,
  settleFriday,
  takeOverFriday,
} from '@/lib/services/fridays';
import {
  addAbsence,
  addGuest,
  addGuestWithPhone,
  consumeLoginToken,
  inviteMember,
  createMember,
  issueLoginToken,
  removeAbsence,
  ServiceError,
  setRoles,
  updateProfile,
} from '@/lib/services/members';
import {
  addItem,
  getItem,
  removeDefaultDish,
  setDefaultDish,
  setItemQuantity,
  setNoFoodDefault,
} from '@/lib/services/orders';
import { payByLink } from '@/lib/services/pay-links';
import { loginCodeText } from '@/lib/messages';
import {
  addMissingDish,
  createDish,
  createDishes,
  createRestaurant,
  deleteAllDishes,
  deleteRestaurant,
  getRestaurant,
  listDishes,
  setHostRestaurant,
  setDishArchived,
  setRestaurantArchived,
  updateDish,
  setRestaurantHosts,
  updateRestaurant,
} from '@/lib/services/restaurants';

const fridayDate = z.string().refine(isFridayIso, 'Das ist kein Freitag');
const isoDate = z.string().refine(isIsoDate, 'Ungültiges Datum');
const memberId = z.coerce.number().int().positive();
const recordId = z.number().int().positive();
const flag = z.boolean();
// Amounts arrive as typed text; anything else is read as nothing typed.
const typedAmount = z.string().max(20).catch('');
const loginField = z.string().max(30).catch('');
const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((value) => value || null);

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/** Runs an action body, turning expected failures into a message for the form. */
async function run(body: () => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    const result = await body();
    refresh();
    return result ?? { ok: true };
  } catch (error) {
    if (error instanceof ServiceError) return fail(error.message);
    if (error instanceof z.ZodError) return fail(error.issues[0]?.message ?? 'Ungültige Eingabe');
    throw error;
  }
}

/** An optional phone field: null when left empty, an error when it is not a number. */
function optionalPhone(input: unknown): string | null {
  const raw = z.string().trim().max(30).parse(input);
  if (!raw) return null;
  const phone = normalizePhone(raw);
  if (!phone) throw new ServiceError('Das sieht nicht nach einer Handynummer aus');
  return phone;
}

function formObject(form: FormData): Record<string, string> {
  return Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
}

/** Who may change whose order on a Friday, looked up fresh for every action. */
async function orderAccess(viewer: Member, date: IsoDate, targetId: number) {
  const db = await getDb();
  const row = await getFridayRow(db, date);
  const hostId = await hostIdFor(db, date);
  const [answer] = await db
    .select({ addedById: attendance.addedById })
    .from(attendance)
    .where(and(eq(attendance.fridayDate, date), eq(attendance.memberId, targetId)));
  const state = {
    locked: Boolean(row?.lockedAt) || isPastDeadline(date),
    settled: Boolean(row?.settledAt),
  };
  if (row?.cancelled) throw new ServiceError('Dieser Freitag fällt aus');
  if (
    !canEditOrderOf(viewer, { id: targetId, addedById: answer?.addedById ?? null }, hostId, state)
  ) {
    throw new ServiceError(
      state.settled
        ? 'Schon abgerechnet – der Gastgeber kann die Abrechnung wieder öffnen'
        : state.locked
          ? 'Bestellschluss ist vorbei – sag dem Gastgeber Bescheid'
          : 'Das darfst du nicht ändern'
    );
  }
  return { db, hostId };
}

async function requireFridayManager(date: IsoDate) {
  const { viewer } = await getGroupContext();
  const db = await getDb();
  const hostId = await hostIdFor(db, date);
  if (!canManageFriday(viewer, hostId)) throw new ServiceError('Das darf nur der Gastgeber');
  return { db, viewer, hostId };
}

async function requireGroupManager() {
  const context = await getGroupContext();
  if (!context.canManage) throw new ServiceError('Das dürfen nur Admins und der Gastgeber');
  return { db: await getDb(), ...context };
}

// ---------------------------------------------------------------- Friday: answers and orders

/** A restaurant's menu for the ballot, with what it takes to order from it there. */
export async function menuPreviewAction(restaurantId: number): Promise<MenuDish[]> {
  await getGroupContext();
  const rows = await listDishes(await getDb(), recordId.parse(restaurantId));
  return rows.map(({ id, category, name, description, priceCents, optionGroups }) => ({
    id,
    category,
    name,
    description,
    priceCents,
    optionGroups,
  }));
}

/** The viewer's vote for a Friday's restaurant, or null to take it back. */
export async function voteAction(date: string, restaurantId: number | null): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { viewer } = await getGroupContext();
    const { dropped, joined } = await castVote(
      await getDb(),
      day,
      viewer.id,
      restaurantId === null ? null : recordId.parse(restaurantId),
      new Date()
    );
    const said = [
      ...(joined ? ['Stimme gezählt, damit bist du dabei'] : []),
      ...(dropped ? ['Deine Vorbestellung ist damit raus'] : []),
    ];
    if (said.length) return { ok: true, message: said.join('. ') };
  });
}

export async function setAnswerAction(input: {
  date: string;
  memberId: number;
  status: 'in' | 'nofood' | 'out';
}): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    const data = z
      .object({ date: fridayDate, memberId, status: z.enum(['in', 'nofood', 'out']) })
      .parse(input);
    const { db } = await orderAccess(viewer, data.date, data.memberId);
    await setAttendance(db, data.date, data.memberId, data.status);
  });
}

const dishChoice = z.object({
  date: fridayDate,
  memberId,
  restaurantId: recordId,
  dishId: recordId,
  selection: z.record(z.string(), z.array(z.string()).max(30)),
  quantity: z.number().int().min(1).max(20),
  note: optionalText,
  saveAsDefault: z.boolean(),
  // Ordered from the ballot: it is the viewer's vote for that restaurant, too.
  vote: z.boolean().default(false),
});

export async function addItemAction(input: z.input<typeof dishChoice>): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    const data = dishChoice.parse(input);
    if (data.vote && data.memberId !== viewer.id) {
      throw new ServiceError('Abstimmen kannst du nur für dich');
    }
    const { db } = await orderAccess(viewer, data.date, data.memberId);
    await addItem(db, data.date, data.memberId, data, { from: data.restaurantId, vote: data.vote });
    const ahead = (await currentRestaurantId(db, data.date)) !== data.restaurantId;
    const done = ahead
      ? `Vorbestellt bei ${(await getRestaurant(db, data.restaurantId))?.name ?? 'deiner Wahl'}`
      : 'Bestellt';
    if (data.saveAsDefault && data.memberId === viewer.id) {
      await setDefaultDish(db, viewer.id, data.restaurantId, data);
      return { ok: true, message: `${done} und als dein Standard gemerkt` };
    }
    return { ok: true, message: ahead ? `${done} – zählt, wenn es gewinnt` : done };
  });
}

export async function setItemQuantityAction(
  itemId: number,
  quantity: number
): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    const db = await getDb();
    const item = await getItem(db, recordId.parse(itemId));
    if (!item) throw new ServiceError('Gibt es nicht mehr');
    await orderAccess(viewer, item.fridayDate, item.memberId);
    await setItemQuantity(db, item.id, z.number().int().min(0).max(20).parse(quantity));
  });
}

export async function removeItemAction(itemId: number): Promise<ActionResult> {
  return setItemQuantityAction(itemId, 0);
}

export async function saveDefaultAction(input: {
  restaurantId: number;
  dishId: number;
  selection: Record<string, string[]>;
  note: string;
}): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    const data = z
      .object({
        restaurantId: recordId,
        dishId: recordId,
        selection: z.record(z.string(), z.array(z.string()).max(30)),
        note: optionalText,
      })
      .parse(input);
    await setDefaultDish(await getDb(), viewer.id, data.restaurantId, data);
    return { ok: true, message: 'Als Standard gemerkt' };
  });
}

export async function setNoFoodDefaultAction(restaurantId: number): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    await setNoFoodDefault(await getDb(), viewer.id, recordId.parse(restaurantId));
    return { ok: true, message: 'Standard: nix essen' };
  });
}

export async function removeDefaultAction(restaurantId: number): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    await removeDefaultDish(await getDb(), viewer.id, recordId.parse(restaurantId));
  });
}

/**
 * Who may bring guests to a Friday: anyone until the deadline, then only whoever runs it.
 * Returns the host's name for the invitation.
 */
async function guestAccess(viewer: Member, date: IsoDate) {
  const db = await getDb();
  const row = await getFridayRow(db, date);
  const hostId = await hostIdFor(db, date);
  const closed = Boolean(row?.lockedAt) || isPastDeadline(date);
  if (row?.cancelled) throw new ServiceError('Dieser Freitag fällt aus');
  if (closed && !canManageFriday(viewer, hostId)) {
    throw new ServiceError('Bestellschluss ist vorbei – der Gastgeber kann noch Gäste eintragen');
  }
  const [host] = hostId
    ? await db.select({ name: members.name }).from(members).where(eq(members.id, hostId))
    : [];
  return { db, hostName: host?.name ?? null };
}

/** Tells a guest with a number that they are on a Friday, unless they put themselves there. */
async function sendGuestInvite(
  member: Member,
  viewer: Member,
  date: IsoDate,
  hostName: string | null
) {
  if (!member.phone || member.id === viewer.id || !whatsappConfigured()) return false;
  await sendWhatsApp(
    member.phone,
    guestInviteText({
      name: member.name,
      invitedBy: viewer.name,
      day: formatDayShort(date),
      host: hostName,
      link: `${appUrl()}/freitag/${date}`,
    })
  );
  return true;
}

/**
 * Adds a guest to a Friday. With a phone number the guest becomes a member outside the
 * Stammtruppe, who gets an invitation by WhatsApp and can log in, order and vote; a known
 * number brings back the member it belongs to.
 */
export async function addGuestAction(
  date: string,
  name: string,
  phoneInput = ''
): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    const data = z
      .object({
        date: fridayDate,
        name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(60),
      })
      .parse({ date, name });
    const phone = optionalPhone(phoneInput);
    const { db, hostName } = await guestAccess(viewer, data.date);
    if (!phone) {
      const guest = await addGuest(db, data.date, data.name, viewer.id);
      return { ok: true, message: `${guest.name} ist dabei` };
    }
    const { member, loginToken } = await addGuestWithPhone(
      db,
      data.date,
      { name: data.name, phone },
      viewer.id
    );
    if (loginToken) {
      if (whatsappConfigured()) {
        await sendWhatsApp(
          phone,
          guestWelcomeText({
            name: member.name,
            invitedBy: viewer.name,
            day: formatDayShort(data.date),
            host: hostName,
            link: loginLink(loginToken),
          })
        );
      }
      return {
        ok: true,
        message: `${member.name} ist dabei und hat eine Einladung per WhatsApp bekommen`,
      };
    }
    await sendGuestInvite(member, viewer, data.date, hostName);
    const known =
      member.name.toLowerCase() !== data.name.toLowerCase()
        ? `Die Nummer gehört ${member.name}, `
        : '';
    return { ok: true, message: `${known}${member.name} ist dabei` };
  });
}

/** Invites a known guest to a Friday again, with a WhatsApp message to say so. */
export async function inviteGuestAction(date: string, target: number): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { viewer } = await getGroupContext();
    const { db, hostName } = await guestAccess(viewer, day);
    const member = await inviteMember(db, day, memberId.parse(target), viewer.id);
    const told = await sendGuestInvite(member, viewer, day, hostName);
    return {
      ok: true,
      message: `${member.name} ist dabei${told ? ' und hat eine Nachricht bekommen' : ''}`,
    };
  });
}

// ---------------------------------------------------------------- Friday: running it

export async function chooseRestaurantAction(
  date: string,
  restaurantId: number | null
): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { db } = await requireFridayManager(day);
    await setRestaurant(db, day, restaurantId === null ? null : recordId.parse(restaurantId));
  });
}

/** Fetch the food instead of having it delivered, and who fetches it (null: the host). */
export async function setPickupAction(
  date: string,
  pickup: boolean,
  pickerId: number | null
): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { db } = await requireFridayManager(day);
    await setPickup(
      db,
      day,
      z.boolean().parse(pickup),
      pickerId === null ? null : memberId.parse(pickerId)
    );
  });
}

export async function setHostAction(date: string, hostId: number | null): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { viewer } = await getGroupContext();
    const db = await getDb();
    if (!canSetHost(viewer, await hostIdFor(db, day))) {
      throw new ServiceError(
        'Den Gastgeber tauschen dürfen nur Admins, der Gastgeber selbst und die Rolle „Vertretungen“'
      );
    }
    await setHost(db, day, hostId === null ? null : memberId.parse(hostId));
  });
}

/** The viewer steps in as host for a Friday whose host is away. */
export async function takeOverAction(date: string): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { viewer } = await getGroupContext();
    await takeOverFriday(await getDb(), day, viewer.id, new Date());
    return { ok: true, message: 'Danke! Du bist jetzt Gastgeber' };
  });
}

export async function setCancelledAction(
  date: string,
  cancelled: boolean,
  reason: string
): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { db } = await requireFridayManager(day);
    await setCancelled(db, day, flag.parse(cancelled), optionalText.parse(reason));
  });
}

export async function setNoteAction(date: string, note: string): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { db } = await requireFridayManager(day);
    await setFridayNote(db, day, optionalText.parse(note));
  });
}

export async function settleAction(date: string, total: string): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { db } = await requireFridayManager(day);
    const cents = parseEuroToCents(typedAmount.parse(total));
    if (cents === null || cents <= 0)
      throw new ServiceError('Bitte den Betrag wie „87,40“ eingeben');
    await settleFriday(db, day, cents, new Date());
    return { ok: true, message: 'Abgerechnet – die Zahlungslinks sind da' };
  });
}

export async function reopenSettlementAction(date: string): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { db } = await requireFridayManager(day);
    await reopenSettlement(db, day);
  });
}

export async function setFlatAction(
  date: string,
  title: string,
  price: string
): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { db } = await requireFridayManager(day);
    const name = z
      .string()
      .trim()
      .min(1, 'Wie heißt der Abend? Zum Beispiel „Grillen“')
      .max(60)
      .parse(title);
    const typed = typedAmount.parse(price).trim();
    const cents = parseEuroToCents(typed);
    if (cents === null || cents <= 0)
      throw new ServiceError('Bitte einen Betrag wie „15“ eingeben');
    await setFlat(db, day, name, cents);
    return { ok: true, message: `${name} für ${typed} € pro Person` };
  });
}

/** „Hab bezahlt“: books what is open, as the server works it out, never a sum from the browser. */
export async function payAction(date: string, target: number): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const id = memberId.parse(target);
    const { viewer } = await getGroupContext();
    const db = await getDb();
    if (id !== viewer.id) {
      const [answer] = await db
        .select({ addedById: attendance.addedById })
        .from(attendance)
        .where(and(eq(attendance.fridayDate, day), eq(attendance.memberId, id)));
      if (answer?.addedById !== viewer.id && !canManageFriday(viewer, await hostIdFor(db, day))) {
        throw new ServiceError('Das darfst du nicht für jemand anderen eintragen');
      }
    }
    const view = await loadFriday(db, day, new Date());
    if (!paymentOpen(view, new Date())) {
      throw new ServiceError('Bezahlt wird erst nach dem Bestellschluss');
    }
    const entry = view.participants.find((participant) => participant.member.id === id);
    const booked = entry
      ? await bookOpen(db, { date: day, memberId: id, money: entry.money, recordedById: viewer.id })
      : 0;
    if (booked <= 0) throw new ServiceError('Da ist nichts offen');
    return { ok: true, message: 'Danke! Als bezahlt vermerkt' };
  });
}

/** Takes the drinks flat fee off someone for a Friday, or puts it back. */
export async function setDrinksAction(
  date: string,
  target: number,
  wantsDrinks: boolean
): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const id = memberId.parse(target);
    const { viewer } = await getGroupContext();
    const { db } = await orderAccess(viewer, day, id);
    await setDrinksOptOut(db, day, id, !z.boolean().parse(wantsDrinks));
  });
}

/** The host's extras for a Friday: a fixed tip (empty = automatic) and the drinks fee. */
export async function setExtrasAction(
  date: string,
  tip: string,
  drinksFee: string,
  voucher: string
): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { db } = await requireFridayManager(day);
    const tipText = typedAmount.parse(tip).trim();
    const tipCents = tipText ? parseEuroToCents(tipText) : null;
    if (tipText && (tipCents === null || tipCents < 0)) {
      throw new ServiceError('Trinkgeld: bitte einen Betrag wie „3“ eingeben oder leer lassen');
    }
    const drinksText = typedAmount.parse(drinksFee).trim();
    const drinksCents = drinksText ? parseEuroToCents(drinksText) : null;
    if (drinksText && (drinksCents === null || drinksCents < 0)) {
      throw new ServiceError('Getränkepauschale: bitte einen Betrag wie „1,50“ eingeben');
    }
    const voucherText = typedAmount.parse(voucher).trim();
    const voucherCents = voucherText ? parseEuroToCents(voucherText) : null;
    if (voucherText && (voucherCents === null || voucherCents < 0)) {
      throw new ServiceError('Gutschein: bitte einen Betrag wie „10“ eingeben oder leer lassen');
    }
    await setTip(db, day, tipCents);
    await setDrinksFee(db, day, drinksCents);
    await setVoucher(db, day, voucherCents || null);
    return { ok: true, message: 'Gespeichert' };
  });
}

/** The host books whatever is still open for someone: received, or paid back when negative. */
export async function settleUpAction(date: string, target: number): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const id = memberId.parse(target);
    const { db, viewer } = await requireFridayManager(day);
    const view = await loadFriday(db, day, new Date());
    if (!paymentOpen(view, new Date())) {
      throw new ServiceError('Bezahlt wird erst nach dem Bestellschluss');
    }
    const entry = view.participants.find((participant) => participant.member.id === id);
    const open = entry?.money.openCents ?? 0;
    if (!entry || entry.money.debts.every((debt) => debt.openCents === 0)) {
      throw new ServiceError('Da ist nichts offen');
    }
    await bookOpen(
      db,
      { date: day, memberId: id, money: entry.money, recordedById: viewer.id },
      { refunds: true }
    );
    return { ok: true, message: open >= 0 ? 'Als bezahlt vermerkt' : 'Als zurückgezahlt vermerkt' };
  });
}

export async function clearPaymentsAction(date: string, target: number): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { db } = await requireFridayManager(day);
    await clearPayments(db, day, memberId.parse(target));
    return { ok: true, message: 'Zahlungen zurückgesetzt' };
  });
}

// ---------------------------------------------------------------- Login

export async function requestCodeAction(phoneInput: string): Promise<ActionResult> {
  try {
    const phone = normalizePhone(loginField.parse(phoneInput));
    if (!phone) return fail('Das sieht nicht nach einer Handynummer aus');
    const db = await getDb();
    const issued = await requestLoginCode(db, phone);
    // The same answer whether or not the number is ours, so it can't be used to look people up.
    const onItsWay = 'Wenn die Nummer bei uns eingetragen ist, kommt der Code gleich per WhatsApp.';
    if (!issued) return { ok: true, message: onItsWay };
    const { code } = issued;
    const result = await sendWhatsApp(phone, loginCodeText(code));
    if (result === 'failed') {
      return fail(
        (await botState()).kind === 'linking'
          ? 'WhatsApp ist noch nicht verbunden. Bis der Admin es unter „Leute“ verbindet, klappt die Anmeldung nur per Login-Link.'
          : 'WhatsApp ist gerade nicht erreichbar. Versuch es gleich nochmal.'
      );
    }
    // Without a bot (local development) the code would go nowhere, so the page shows it.
    if (result === 'logged' && process.env.NODE_ENV !== 'production') {
      return { ok: true, message: `Entwicklungsmodus: dein Code ist ${code}` };
    }
    if (result === 'logged')
      return fail('Der WhatsApp-Bot ist nicht eingerichtet. Frag den Gastgeber nach deinem Link.');
    return { ok: true, message: onItsWay };
  } catch (error) {
    if (error instanceof ServiceError) return fail(error.message);
    throw error;
  }
}

/** „Hab bezahlt“ from the link in a payment reminder; works without a login. */
export async function payByLinkAction(token: string): Promise<void> {
  const paid = await payByLink(await getDb(), z.string().max(100).parse(token), new Date());
  redirect(`/bezahlt/${encodeURIComponent(token)}${paid ? '?ok=1' : ''}`);
}

/** Uses up a personal login link and signs its member in on this device. */
export async function signInWithLinkAction(token: string): Promise<void> {
  const db = await getDb();
  const member = await consumeLoginToken(db, z.string().max(200).parse(token));
  if (!member) redirect('/login?link=invalid');
  (await cookies()).set(SESSION_COOKIE, await createSession(db, member.id), sessionCookieOptions());
  redirect('/');
}

export async function verifyCodeAction(phoneInput: string, code: string): Promise<ActionResult> {
  const phone = normalizePhone(loginField.parse(phoneInput));
  if (!phone) return fail('Das sieht nicht nach einer Handynummer aus');
  let token: string;
  try {
    const db = await getDb();
    const member = await verifyLoginCode(db, phone, loginField.parse(code));
    token = await createSession(db, member.id);
  } catch (error) {
    if (error instanceof ServiceError) return fail(error.message);
    throw error;
  }
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
  redirect('/');
}

// ---------------------------------------------------------------- People

export async function createMemberAction(
  _: ActionResult | null,
  form: FormData
): Promise<ActionResult> {
  return run(async () => {
    const { db, viewer } = await requireGroupManager();
    const data = z
      .object({
        name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(60),
        phone: z.string().trim().min(1, 'Bitte die Handynummer angeben – damit meldet man sich an'),
        isAdmin: z.string().optional(),
        assignsHosts: z.string().optional(),
        core: z.string().optional(),
      })
      .parse(formObject(form));
    const phone = normalizePhone(data.phone);
    if (!phone) throw new ServiceError('Das sieht nicht nach einer Handynummer aus');
    const core = data.core === 'on';
    const { member, loginToken } = await createMember(
      db,
      {
        name: data.name,
        phone,
        isAdmin: viewer.isAdmin && data.isAdmin === 'on',
        assignsHosts: viewer.isAdmin && data.assignsHosts === 'on',
        core,
      },
      viewer.id
    ).catch((error: unknown) => {
      if (String(error).includes('unique'))
        throw new ServiceError('Diese Nummer ist schon eingetragen');
      throw error;
    });
    if (whatsappConfigured()) {
      await sendWhatsApp(
        phone,
        welcomeText({
          name: member.name,
          invitedBy: viewer.name,
          link: loginLink(loginToken),
          core,
        })
      );
    }
    return { ok: true, message: `${member.name} ist angelegt`, link: loginLink(loginToken) };
  });
}

/** An admin logs the bot's WhatsApp out to link another number, by QR or pairing code. */
export async function relinkWhatsAppAction(phoneInput: string): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    if (!viewer.isAdmin) throw new ServiceError('Das dürfen nur Admins');
    const phone = optionalPhone(phoneInput);
    if (!(await relinkBot(phone))) throw new ServiceError('Der Bot antwortet gerade nicht');
    return {
      ok: true,
      message: phone
        ? 'Abgemeldet – gleich steht hier der Code für die neue Nummer'
        : 'Abgemeldet – gleich steht hier ein neuer QR-Code',
    };
  });
}

export async function issueLoginLinkAction(target: number): Promise<ActionResult> {
  return run(async () => {
    const { db, viewer } = await requireGroupManager();
    const id = memberId.parse(target);
    const [member] = await db.select().from(members).where(eq(members.id, id));
    if (!member) throw new ServiceError('Mitglied nicht gefunden');
    // A link lets whoever holds it in as that person, so for existing members only an
    // admin may make one; a host may still turn a guest into a member.
    if (member.kind === 'member' && !viewer.isAdmin) {
      throw new ServiceError('Neue Links für Mitglieder kann nur ein Admin erzeugen');
    }
    const token = await issueLoginToken(db, id);
    return {
      ok: true,
      message:
        member.kind === 'guest'
          ? `${member.name} ist jetzt Mitglied`
          : `Neuer Link für ${member.name} – alte Links und Anmeldungen gelten nicht mehr`,
      link: loginLink(token),
    };
  });
}

export async function setRolesAction(
  target: number,
  roles: {
    isAdmin?: boolean;
    isDefaultHost?: boolean;
    assignsHosts?: boolean;
    active?: boolean;
    core?: boolean;
  }
): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    if (!viewer.isAdmin) throw new ServiceError('Das dürfen nur Admins');
    const id = memberId.parse(target);
    const changes = z
      .object({
        isAdmin: flag,
        isDefaultHost: flag,
        assignsHosts: flag,
        active: flag,
        core: flag,
      })
      .partial()
      .parse(roles);
    if (id === viewer.id && (changes.isAdmin === false || changes.active === false)) {
      throw new ServiceError('Dich selbst kannst du hier nicht aussperren');
    }
    await setRoles(await getDb(), id, changes);
  });
}

/** The viewer's own details. The phone number is the login, so only an admin changes it. */
export async function updateProfileAction(
  _: ActionResult | null,
  form: FormData
): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    const data = z
      .object({
        name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(60),
        paypalMe: optionalText,
        address: optionalText,
        defaultRestaurantId: z
          .string()
          .optional()
          .transform((value) => (value ? Number(value) : null))
          .pipe(recordId.nullable()),
      })
      .parse(formObject(form));
    const paypalMe = data.paypalMe ? normalizePaypalHandle(data.paypalMe) : null;
    if (data.paypalMe && !paypalMe)
      throw new ServiceError('Das sieht nicht nach einem PayPal.me-Namen aus');
    await updateProfile(await getDb(), viewer.id, { ...data, paypalMe });
    return { ok: true, message: 'Gespeichert' };
  });
}

/** An admin corrects someone's name or phone number. */
export async function updateMemberAction(
  target: number,
  name: string,
  phoneInput: string
): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    if (!viewer.isAdmin) throw new ServiceError('Das dürfen nur Admins');
    const id = memberId.parse(target);
    const cleanName = z.string().trim().min(1, 'Bitte einen Namen angeben').max(60).parse(name);
    const phone = optionalPhone(phoneInput);
    await updateProfile(await getDb(), id, { name: cleanName, phone }).catch((error: unknown) => {
      if (String(error).includes('unique'))
        throw new ServiceError('Diese Nummer gehört schon jemand anderem');
      throw error;
    });
    return { ok: true, message: 'Gespeichert' };
  });
}

export async function addAbsenceAction(
  _: ActionResult | null,
  form: FormData
): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    const data = z
      .object({ fromDate: isoDate, toDate: isoDate, note: optionalText })
      .parse(formObject(form));
    const db = await getDb();
    await addAbsence(db, viewer.id, data.fromDate, data.toDate, data.note);
    const hosting = await hostedFridaysBetween(
      db,
      viewer.id,
      data.fromDate,
      data.toDate,
      new Date()
    );
    return hosting.length
      ? {
          ok: true,
          message: `Eingetragen. Am ${formatDayList(hosting)} bist du Gastgeber – wähl oben im Kalender, wer übernimmt, oder sag ab.`,
        }
      : { ok: true };
  });
}

export async function removeAbsenceAction(absenceId: number): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    await removeAbsence(await getDb(), viewer.id, recordId.parse(absenceId));
  });
}

export async function logoutAction() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(await getDb(), token);
  store.delete(SESSION_COOKIE);
  redirect('/login');
}

// ---------------------------------------------------------------- Restaurants

const restaurantForm = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(80),
  cuisine: optionalText,
  lieferandoUrl: z
    .string()
    .trim()
    .max(300)
    .refine(
      (value) => !value || /^https:\/\/(www\.)?lieferando\.de\//.test(value),
      'Bitte einen Lieferando-Link angeben'
    )
    .transform((value) => value || null),
  minOrder: z.string(),
  deliveryFee: z.string(),
  freeDeliveryFrom: z.string(),
  serviceFee: z.string(),
  tip: z.string(),
  notes: optionalText,
  pickup: z.string().optional(),
});

function euroField(value: string, label: string, optional = false): number | null {
  if (!value.trim()) {
    if (optional) return null;
    return 0;
  }
  const cents = parseEuroToCents(value);
  if (cents === null || cents < 0)
    throw new ServiceError(`${label}: bitte einen Betrag wie „2,99“ eingeben`);
  return cents;
}

function restaurantInput(form: FormData) {
  const data = restaurantForm.parse(formObject(form));
  return {
    name: data.name,
    cuisine: data.cuisine,
    lieferandoUrl: data.lieferandoUrl,
    minOrderCents: euroField(data.minOrder, 'Mindestbestellwert')!,
    deliveryFeeCents: euroField(data.deliveryFee, 'Liefergebühr')!,
    freeDeliveryFromCents: euroField(data.freeDeliveryFrom, 'Kostenlos ab', true),
    serviceFeeCents: euroField(data.serviceFee, 'Servicegebühr')!,
    tipCents: euroField(data.tip, 'Trinkgeld')!,
    notes: data.notes,
    pickup: data.pickup === 'on',
  };
}

/** The hosts ticked under „Liefert zu“. */
function deliveryArea(form: FormData): number[] {
  return z.array(z.coerce.number().int().positive()).max(200).parse(form.getAll('deliversTo'));
}

export async function createRestaurantAction(
  _: ActionResult | null,
  form: FormData
): Promise<ActionResult> {
  let id: number | null = null;
  const result = await run(async () => {
    const { db } = await requireGroupManager();
    id = (await createRestaurant(db, restaurantInput(form))).id;
    await setRestaurantHosts(db, id, deliveryArea(form));
  });
  if (result.ok && id) redirect(`/restaurants/${id}`);
  return result;
}

export async function updateRestaurantAction(
  _: ActionResult | null,
  form: FormData
): Promise<ActionResult> {
  return run(async () => {
    const { db } = await requireGroupManager();
    const id = z.coerce.number().int().positive().parse(form.get('id'));
    await updateRestaurant(db, id, restaurantInput(form));
    await setRestaurantHosts(db, id, deliveryArea(form));
    return { ok: true, message: 'Gespeichert' };
  });
}

/** The viewer's usual restaurant for the Fridays they host. */
export async function setHostRestaurantAction(id: number): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    await setHostRestaurant(await getDb(), viewer.id, recordId.parse(id));
    return { ok: true, message: 'Gemerkt: Wenn du Gastgeber bist, bestellen wir hier' };
  });
}

/**
 * Any member may add a dish the menu is missing; it is saved for everyone. With a Friday
 * it is ordered straight away for the viewer.
 */
export async function addMissingDishAction(input: {
  restaurantId: number;
  name: string;
  price: string;
  description: string;
  date?: string;
}): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    const data = z
      .object({
        restaurantId: recordId,
        name: z.string().trim().min(1, 'Wie heißt das Gericht?').max(120),
        price: z.string(),
        description: optionalText,
        date: fridayDate.optional(),
      })
      .parse(input);
    const priceCents = parseEuroToCents(data.price);
    if (priceCents === null)
      throw new ServiceError('Preis: bitte einen Betrag wie „8,50“ eingeben');
    // Checked before the dish exists, so a refused order leaves no stray dish behind.
    if (data.date) await orderAccess(viewer, data.date, viewer.id);
    const db = await getDb();
    const dish = await addMissingDish(
      db,
      data.restaurantId,
      { name: data.name, description: data.description, priceCents },
      viewer.id
    );
    if (!data.date) return { ok: true, message: `${dish.name} steht jetzt auf der Karte` };
    await addItem(
      db,
      data.date,
      viewer.id,
      { dishId: dish.id, selection: {}, note: null, quantity: 1 },
      { from: data.restaurantId }
    );
    return { ok: true, message: `${dish.name} eingetragen und bestellt` };
  });
}

export async function archiveRestaurantAction(
  id: number,
  archived: boolean
): Promise<ActionResult> {
  return run(async () => {
    const { db } = await requireGroupManager();
    await setRestaurantArchived(db, recordId.parse(id), flag.parse(archived));
    return { ok: true, message: archived ? 'Nicht mehr im Angebot' : 'Wieder im Angebot' };
  });
}

export async function deleteRestaurantAction(id: number): Promise<ActionResult> {
  const result = await run(async () => {
    const { db } = await requireGroupManager();
    await deleteRestaurant(db, recordId.parse(id));
  });
  if (result.ok) redirect('/restaurants');
  return result;
}

const dishForm = z.object({
  restaurantId: z.coerce.number().int().positive(),
  dishId: z.coerce.number().int().positive().optional(),
  category: optionalText,
  name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(120),
  description: optionalText,
  price: z.string(),
  options: z.string().max(4000).default(''),
});

function dishInput(form: FormData) {
  const data = dishForm.parse(formObject(form));
  const priceCents = parseEuroToCents(data.price);
  if (priceCents === null || priceCents < 0)
    throw new ServiceError('Preis: bitte einen Betrag wie „8,50“ eingeben');
  const { groups, errors } = parseOptionGroups(data.options);
  if (errors.length) throw new ServiceError(errors[0]!);
  return {
    restaurantId: data.restaurantId,
    dishId: data.dishId,
    input: {
      category: data.category,
      name: data.name,
      description: data.description,
      priceCents,
      optionGroups: groups,
    },
  };
}

export async function saveDishAction(
  _: ActionResult | null,
  form: FormData
): Promise<ActionResult> {
  return run(async () => {
    const { db } = await requireGroupManager();
    const { restaurantId, dishId, input } = dishInput(form);
    if (dishId) await updateDish(db, restaurantId, dishId, input);
    else await createDish(db, restaurantId, input);
    return { ok: true, message: dishId ? 'Gespeichert' : `${input.name} ist auf der Karte` };
  });
}

/** Saves the dishes the import preview kept; they are checked here again, not trusted. */
export async function bulkAddDishesAction(
  restaurantId: number,
  dishes: {
    category: string | null;
    name: string;
    priceCents: number;
    description: string | null;
  }[]
): Promise<ActionResult> {
  return run(async () => {
    const { db } = await requireGroupManager();
    const data = z
      .array(
        z.object({
          // A pasted menu is cut to fit rather than refused over one long line.
          category: z
            .string()
            .trim()
            .transform((text) => text.slice(0, 80))
            .nullable(),
          name: z
            .string()
            .trim()
            .min(1)
            .transform((text) => text.slice(0, 120)),
          priceCents: z.number().int().min(0).max(100_000),
          description: z
            .string()
            .trim()
            .transform((text) => text.slice(0, 300))
            .nullable(),
        })
      )
      .min(1, 'Keine Gerichte ausgewählt')
      .max(500)
      .parse(dishes);
    const { added, updated } = await createDishes(db, recordId.parse(restaurantId), data);
    return {
      ok: true,
      message: [added && `${added} neu`, updated && `${updated} aktualisiert`]
        .filter(Boolean)
        .join(', '),
    };
  });
}

export async function deleteAllDishesAction(restaurantId: number): Promise<ActionResult> {
  return run(async () => {
    const { db } = await requireGroupManager();
    const removed = await deleteAllDishes(db, recordId.parse(restaurantId));
    return { ok: true, message: `${removed} ${removed === 1 ? 'Gericht' : 'Gerichte'} gelöscht` };
  });
}

export async function archiveDishAction(
  restaurantId: number,
  dishId: number,
  archived: boolean
): Promise<ActionResult> {
  return run(async () => {
    const { db } = await requireGroupManager();
    await setDishArchived(
      db,
      recordId.parse(restaurantId),
      recordId.parse(dishId),
      flag.parse(archived)
    );
  });
}
