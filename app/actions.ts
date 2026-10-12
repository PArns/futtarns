'use server';

import { and, eq } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { loginLink } from '@/lib/auth-tokens';
import { isFridayIso, isIsoDate, isPastDeadline, type IsoDate } from '@/lib/dates';
import { getDb } from '@/lib/db';
import { attendance, members, type Member } from '@/lib/db/schema';
import { parseBulkDishes } from '@/lib/menu/bulk';
import { parseEuroToCents, parseOptionGroups } from '@/lib/menu/options';
import { normalizePaypalHandle } from '@/lib/paypal';
import { normalizePhone } from '@/lib/phone';
import { whatsappConfigured, sendWhatsApp } from '@/lib/whatsapp';
import { canEditOrderOf, canManageFriday } from '@/lib/permissions';
import { getGroupContext, SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';
import {
  createSession,
  deleteSession,
  requestLoginCode,
  verifyLoginCode,
} from '@/lib/services/auth';
import {
  clearPayments,
  getFridayRow,
  hostIdFor,
  loadFriday,
  recordPayment,
  reopenSettlement,
  setAttendance,
  setCancelled,
  setDrinksFee,
  setDrinksOptOut,
  setFlat,
  setFridayNote,
  setHost,
  setRestaurant,
  setTip,
  settleFriday,
} from '@/lib/services/fridays';
import {
  addAbsence,
  addGuest,
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
} from '@/lib/services/orders';
import {
  createDish,
  createDishes,
  createRestaurant,
  setDishArchived,
  setRestaurantArchived,
  updateDish,
  updateRestaurant,
} from '@/lib/services/restaurants';

const fridayDate = z.string().refine(isFridayIso, 'Das ist kein Freitag');
const isoDate = z.string().refine(isIsoDate, 'Ungültiges Datum');
const memberId = z.coerce.number().int().positive();
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
  dishId: z.number().int().positive(),
  selection: z.record(z.string(), z.array(z.string()).max(30)),
  quantity: z.number().int().min(1).max(20),
  note: optionalText,
  saveAsDefault: z.boolean(),
});

export async function addItemAction(input: z.input<typeof dishChoice>): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    const data = dishChoice.parse(input);
    const { db } = await orderAccess(viewer, data.date, data.memberId);
    await addItem(db, data.date, data.memberId, data);
    if (data.saveAsDefault && data.memberId === viewer.id) {
      const row = await getFridayRow(db, data.date);
      if (row?.restaurantId) await setDefaultDish(db, viewer.id, row.restaurantId, data);
      return { ok: true, message: 'Bestellt und als dein Standard gemerkt' };
    }
    return { ok: true, message: 'Bestellt' };
  });
}

export async function setItemQuantityAction(
  itemId: number,
  quantity: number
): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    const db = await getDb();
    const item = await getItem(db, z.number().int().positive().parse(itemId));
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
        restaurantId: z.number().int().positive(),
        dishId: z.number().int().positive(),
        selection: z.record(z.string(), z.array(z.string()).max(30)),
        note: optionalText,
      })
      .parse(input);
    await setDefaultDish(await getDb(), viewer.id, data.restaurantId, data);
    return { ok: true, message: 'Als Standard gemerkt' };
  });
}

export async function removeDefaultAction(restaurantId: number): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    await removeDefaultDish(
      await getDb(),
      viewer.id,
      z.number().int().positive().parse(restaurantId)
    );
  });
}

export async function addGuestAction(date: string, name: string): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    const data = z
      .object({
        date: fridayDate,
        name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(60),
      })
      .parse({ date, name });
    const db = await getDb();
    const row = await getFridayRow(db, data.date);
    const hostId = await hostIdFor(db, data.date);
    const closed = Boolean(row?.lockedAt) || isPastDeadline(data.date);
    if (row?.cancelled) throw new ServiceError('Dieser Freitag fällt aus');
    if (closed && !canManageFriday(viewer, hostId)) {
      throw new ServiceError('Bestellschluss ist vorbei – der Gastgeber kann noch Gäste eintragen');
    }
    const guest = await addGuest(db, data.date, data.name, viewer.id);
    return { ok: true, message: `${guest.name} ist dabei` };
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
    await setRestaurant(
      db,
      day,
      restaurantId === null ? null : z.number().int().positive().parse(restaurantId)
    );
  });
}

export async function setHostAction(date: string, hostId: number | null): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { db } = await requireFridayManager(day);
    await setHost(db, day, hostId === null ? null : memberId.parse(hostId));
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
    await setCancelled(db, day, cancelled, optionalText.parse(reason));
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
    const cents = parseEuroToCents(total);
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
    const cents = parseEuroToCents(price);
    if (cents === null || cents <= 0)
      throw new ServiceError('Bitte einen Betrag wie „15“ eingeben');
    await setFlat(db, day, name, cents);
    return { ok: true, message: `${name} für ${price.trim()} € pro Person` };
  });
}

/**
 * Books a payment the viewer says they sent: for themselves, or for a guest they brought.
 * The amount is the one their PayPal link carried, so the ledger matches the money.
 */
export async function payAction(
  date: string,
  target: number,
  amountCents: number
): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const id = memberId.parse(target);
    const amount = z.number().int().min(1).max(100_000).parse(amountCents);
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
    await recordPayment(db, {
      date: day,
      memberId: id,
      amountCents: amount,
      recordedById: viewer.id,
    });
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
  drinksFee: string
): Promise<ActionResult> {
  return run(async () => {
    const day = fridayDate.parse(date);
    const { db } = await requireFridayManager(day);
    const tipCents = tip.trim() ? parseEuroToCents(tip) : null;
    if (tip.trim() && (tipCents === null || tipCents < 0)) {
      throw new ServiceError('Trinkgeld: bitte einen Betrag wie „3“ eingeben oder leer lassen');
    }
    const drinksCents = drinksFee.trim() ? parseEuroToCents(drinksFee) : null;
    if (drinksFee.trim() && (drinksCents === null || drinksCents < 0)) {
      throw new ServiceError('Getränkepauschale: bitte einen Betrag wie „1,50“ eingeben');
    }
    await setTip(db, day, tipCents);
    await setDrinksFee(db, day, drinksCents);
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
    const entry = view.participants.find((participant) => participant.member.id === id);
    const open = entry?.money.openCents ?? 0;
    if (open === 0) throw new ServiceError('Da ist nichts offen');
    await recordPayment(db, {
      date: day,
      memberId: id,
      amountCents: open,
      recordedById: viewer.id,
    });
    return { ok: true, message: open > 0 ? 'Als bezahlt vermerkt' : 'Als zurückgezahlt vermerkt' };
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
    const phone = normalizePhone(phoneInput);
    if (!phone) return fail('Das sieht nicht nach einer Handynummer aus');
    const db = await getDb();
    const { code } = await requestLoginCode(db, phone);
    const result = await sendWhatsApp(
      phone,
      `Dein Code für freitach: ${code}\nEr gilt 10 Minuten.`
    );
    if (result === 'failed')
      return fail('WhatsApp ist gerade nicht erreichbar. Versuch es gleich nochmal.');
    // Without a bot (local development) the code would go nowhere, so the page shows it.
    if (result === 'logged' && process.env.NODE_ENV !== 'production') {
      return { ok: true, message: `Entwicklungsmodus: dein Code ist ${code}` };
    }
    if (result === 'logged')
      return fail('Der WhatsApp-Bot ist nicht eingerichtet. Frag den Gastgeber nach deinem Link.');
    return { ok: true, message: 'Code ist unterwegs – schau in WhatsApp' };
  } catch (error) {
    if (error instanceof ServiceError) return fail(error.message);
    throw error;
  }
}

export async function verifyCodeAction(phoneInput: string, code: string): Promise<ActionResult> {
  const phone = normalizePhone(phoneInput);
  if (!phone) return fail('Das sieht nicht nach einer Handynummer aus');
  let token: string;
  try {
    const db = await getDb();
    const member = await verifyLoginCode(db, phone, code);
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
      })
      .parse(formObject(form));
    const phone = normalizePhone(data.phone);
    if (!phone) throw new ServiceError('Das sieht nicht nach einer Handynummer aus');
    const { member, loginToken } = await createMember(
      db,
      { name: data.name, phone, isAdmin: viewer.isAdmin && data.isAdmin === 'on' },
      viewer.id
    ).catch((error: unknown) => {
      if (String(error).includes('unique'))
        throw new ServiceError('Diese Nummer ist schon eingetragen');
      throw error;
    });
    if (whatsappConfigured()) {
      await sendWhatsApp(
        phone,
        `Hi ${member.name}! ${viewer.name} hat dich bei freitach eingetragen, da organisieren wir den Freitag.\nAnmelden: ${loginLink(loginToken)}\n\nAntworte mit „hilfe“, um zu sehen, was ich kann.`
      );
    }
    return { ok: true, message: `${member.name} ist angelegt`, link: loginLink(loginToken) };
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
  roles: { isAdmin?: boolean; isDefaultHost?: boolean; active?: boolean }
): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    if (!viewer.isAdmin) throw new ServiceError('Das dürfen nur Admins');
    const id = memberId.parse(target);
    if (id === viewer.id && (roles.isAdmin === false || roles.active === false)) {
      throw new ServiceError('Dich selbst kannst du hier nicht aussperren');
    }
    await setRoles(
      await getDb(),
      id,
      z
        .object({ isAdmin: z.boolean(), isDefaultHost: z.boolean(), active: z.boolean() })
        .partial()
        .parse(roles)
    );
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
    const phone = phoneInput.trim() ? normalizePhone(phoneInput) : null;
    if (phoneInput.trim() && !phone)
      throw new ServiceError('Das sieht nicht nach einer Handynummer aus');
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
    await addAbsence(await getDb(), viewer.id, data.fromDate, data.toDate, data.note);
    return { ok: true, message: 'Eingetragen' };
  });
}

export async function removeAbsenceAction(absenceId: number): Promise<ActionResult> {
  return run(async () => {
    const { viewer } = await getGroupContext();
    await removeAbsence(await getDb(), viewer.id, z.number().int().positive().parse(absenceId));
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
  notes: optionalText,
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
    notes: data.notes,
  };
}

export async function createRestaurantAction(
  _: ActionResult | null,
  form: FormData
): Promise<ActionResult> {
  let id: number | null = null;
  const result = await run(async () => {
    const { db } = await requireGroupManager();
    id = (await createRestaurant(db, restaurantInput(form))).id;
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
    return { ok: true, message: 'Gespeichert' };
  });
}

export async function archiveRestaurantAction(
  id: number,
  archived: boolean
): Promise<ActionResult> {
  return run(async () => {
    const { db } = await requireGroupManager();
    await setRestaurantArchived(db, z.number().int().positive().parse(id), archived);
  });
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

export async function bulkAddDishesAction(
  _: ActionResult | null,
  form: FormData
): Promise<ActionResult> {
  return run(async () => {
    const { db } = await requireGroupManager();
    const restaurantId = z.coerce.number().int().positive().parse(form.get('restaurantId'));
    // Lines without a price were already shown as skipped in the preview.
    const { dishes } = parseBulkDishes(String(form.get('menu') ?? ''));
    if (dishes.length === 0) throw new ServiceError('Keine Gerichte gefunden');
    const { added, updated } = await createDishes(db, restaurantId, dishes);
    return {
      ok: true,
      message: [added && `${added} neu`, updated && `${updated} aktualisiert`]
        .filter(Boolean)
        .join(', '),
    };
  });
}

export async function archiveDishAction(
  restaurantId: number,
  dishId: number,
  archived: boolean
): Promise<ActionResult> {
  return run(async () => {
    const { db } = await requireGroupManager();
    await setDishArchived(db, restaurantId, dishId, archived);
  });
}
