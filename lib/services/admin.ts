import { and, asc, count, desc, eq, gte } from 'drizzle-orm';
import { appUrl } from '@/lib/auth-tokens';
import type { AdminChange } from '@/lib/commands';
import {
  addWeeks,
  berlinAt,
  currentFriday,
  daysBetween,
  isFridayIso,
  isIsoDate,
  isPastDeadline,
  todayIso,
  type IsoDate,
} from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import { adminNotes, members, type Member } from '@/lib/db/schema';
import { formatDayList, formatDayShort, formatWeekdayTime } from '@/lib/format';
import { bold } from '@/lib/messages';
import { canClearHost, canEditOrderOf } from '@/lib/permissions';
import type { Outgoing } from '@/lib/reminders';
import {
  clearHost,
  getFridayRow,
  hostIdFor,
  hostedFridaysBetween,
  loadCalendar,
  loadFriday,
  setAttendance,
  setCancelled,
  setHost,
} from '@/lib/services/fridays';
import {
  absencesOverlapping,
  addAbsence,
  getDefaultHost,
  ServiceError,
} from '@/lib/services/members';

/**
 * What reaches the admins by chat, and what they change by it: Claude passes on what a
 * member's message holds for them (`reportToAdmins`), and an admin's instructions come back
 * as changes (`runAdminChanges`), each checked like the page would.
 */

/** How many reports from one member reach the admins per day, so nobody floods them. */
export const REPORTS_PER_DAY = 3;

/** How far back the admins' facts list the reports. */
const REPORT_DAYS = 7;

/** The longest part of the member's own message that goes along with a report. */
const QUOTE = 400;

/** How far ahead a Friday can be changed by chat. */
const AHEAD_WEEKS = 52;

/** The admins a report goes to: active members with a phone, but not whoever wrote it. */
async function adminsBut(db: Db, memberId: number): Promise<Member[]> {
  const rows = await db
    .select()
    .from(members)
    .where(and(eq(members.isAdmin, true), eq(members.active, true), eq(members.kind, 'member')));
  return rows.filter((row) => row.phone && row.id !== memberId);
}

/**
 * Passes on what Claude found worth telling the admins: stores it with the member's own
 * message and returns the messages for the admins. Null when no other admin can be told,
 * or the member has reported enough for today.
 */
export async function reportToAdmins(
  db: Db,
  from: Member,
  note: string,
  message: string,
  now: Date
): Promise<Outgoing[] | null> {
  const admins = await adminsBut(db, from.id);
  if (admins.length === 0) return null;
  const [today] = await db
    .select({ reports: count() })
    .from(adminNotes)
    .where(
      and(
        eq(adminNotes.memberId, from.id),
        gte(adminNotes.createdAt, new Date(now.getTime() - 24 * 3_600_000))
      )
    );
  if ((today?.reports ?? 0) >= REPORTS_PER_DAY) return null;
  const said = message.trim();
  const [row] = await db
    .insert(adminNotes)
    .values({ memberId: from.id, note, message: said, createdAt: now })
    .returning();
  const quote = said.length > QUOTE ? `${said.slice(0, QUOTE - 1).trimEnd()}…` : said;
  const text = [
    `📨 ${bold(`Meldung von ${from.name}`)} (über den Bot):`,
    note,
    '',
    `${from.name} schrieb: „${quote}“`,
    '',
    `Soll ich was ändern? Schreib’s mir einfach, z. B. „Ina macht Freitag den Gastgeber“ oder „schreib ${from.name}, dass es erledigt ist“.`,
  ].join('\n');
  return admins.map((admin) => ({
    key: `adminnote:${row!.id}:${admin.id}`,
    to: admin.phone!,
    text,
  }));
}

/** The reports of the last days, newest first, for the admins' facts. */
export async function recentReports(db: Db, now: Date) {
  return db
    .select({
      id: adminNotes.id,
      name: members.name,
      note: adminNotes.note,
      createdAt: adminNotes.createdAt,
    })
    .from(adminNotes)
    .innerJoin(members, eq(members.id, adminNotes.memberId))
    .where(gte(adminNotes.createdAt, new Date(now.getTime() - REPORT_DAYS * 86_400_000)))
    .orderBy(desc(adminNotes.createdAt))
    .limit(8);
}

/**
 * What Claude needs to carry out an admin's instructions: everyone with their number, the
 * coming Fridays with host and who is away, and what was reported lately.
 */
export async function adminFacts(db: Db, now: Date): Promise<string[]> {
  const people = await db
    .select()
    .from(members)
    .where(and(eq(members.active, true), eq(members.kind, 'member')))
    .orderBy(asc(members.name));
  const nameOf = (id: number) => people.find((person) => person.id === id)?.name ?? '?';
  const calendar = await loadCalendar(db, currentFriday(now), 6);
  const reports = await recentReports(db, now);
  return [
    'Als Admin kannst du mir Änderungen auftragen (Aktion admin): Gastgeber, Absagen, Antworten und Abwesenheiten anderer, Nachrichten an jemanden.',
    `Leute (Nummer · Name · Rolle): ${people
      .map(
        (person) =>
          `${person.id} · ${person.name} · ${[
            person.core ? 'Stammtruppe' : 'Gast',
            ...(person.isAdmin ? ['Admin'] : []),
            ...(person.isDefaultHost ? ['Standard-Gastgeber'] : []),
          ].join(', ')}`
      )
      .join('; ')}.`,
    'Die nächsten Freitage:',
    ...calendar.map(
      (entry) =>
        `${entry.date} (${formatDayShort(entry.date)}): ${
          entry.cancelled
            ? 'fällt aus'
            : entry.host
              ? `bei ${entry.host.name}${entry.hostAbsent ? ' (ist an dem Tag weg)' : ''}`
              : 'kein Gastgeber'
        }${entry.absentMemberIds.length ? `, weg: ${entry.absentMemberIds.map(nameOf).join(', ')}` : ''}`
    ),
    'Meldungen an die Admins (letzte 7 Tage, neueste zuerst):',
    ...(reports.length
      ? reports.map(
          (report) => `${formatWeekdayTime(report.createdAt)} Uhr, ${report.name}: ${report.note}`
        )
      : ['keine']),
  ];
}

const STATUS_TEXT = { in: 'dabei', nofood: 'dabei, ohne Essen', out: 'raus' } as const;

/** A change as it will run: what it does, whether it needs „sicher“, and running it. */
type Plan =
  | { ok: false; line: string; done?: boolean }
  | {
      ok: true;
      what: string;
      /** Why it needs „sicher“ first, if it does. */
      confirm?: string;
      apply: () => Promise<{ line: string; messages?: Outgoing[] }>;
    };

/**
 * Carries out what an admin asked for by chat, with the page's rules: each change is checked
 * first, and when one of them needs „sicher“ and the message did not say it, none runs.
 * Says what came of each and returns the messages to send afterwards.
 */
export async function runAdminChanges(
  db: Db,
  admin: Member,
  changes: AdminChange[],
  confirmed: boolean,
  now: Date
): Promise<{ text: string; messages: Outgoing[] }> {
  if (!admin.isAdmin) {
    return { text: 'Änderungen für andere macht nur ein Admin.', messages: [] };
  }
  const people = await db.select().from(members).where(eq(members.active, true));
  const thisWeek = currentFriday(now);
  const today = todayIso(now);
  const link = (date: IsoDate) => `${appUrl()}/freitag/${date}`;
  const fail = (line: string): Plan => ({ ok: false, line });
  const already = (line: string): Plan => ({ ok: false, line, done: true });

  /** The Friday a change is about, or why it cannot be changed by chat. */
  const fridayOf = (change: AdminChange): IsoDate | string => {
    const date = change.date ?? '';
    if (!isIsoDate(date) || !isFridayIso(date)) return 'Das Datum ist kein Freitag.';
    if (date < thisWeek) return `Freitag (${formatDayShort(date)}) ist schon vorbei.`;
    if (date > addWeeks(thisWeek, AHEAD_WEEKS)) return 'So weit voraus geht das nur auf der Seite.';
    return date;
  };
  /** Whether a Friday still takes changes to its host or whether it happens. */
  const closed = async (date: IsoDate) =>
    Boolean((await getFridayRow(db, date))?.lockedAt) || isPastDeadline(date, now);
  const personOf = (id: number | null) =>
    people.find((person) => person.id === id && person.kind === 'member') ?? null;

  const plan = async (change: AdminChange, index: number): Promise<Plan> => {
    switch (change.kind) {
      case 'set_host': {
        const date = fridayOf(change);
        if (!isIsoDate(date)) return fail(date);
        const day = formatDayShort(date);
        if (await closed(date)) {
          return fail(
            `Freitag (${day}) ist schon geschlossen, den Gastgeber tauschst du auf der Seite.`
          );
        }
        const current = await hostIdFor(db, date);
        if (change.memberId === null) {
          const usual = await getDefaultHost(db);
          if (!usual) return fail('Es gibt keinen Standard-Gastgeber.');
          return {
            ok: true,
            what: `Freitag (${day}) wieder zu ${usual.name}`,
            apply: async () => {
              await setHost(db, date, null);
              return { line: `Freitag (${day}) ist wieder bei ${bold(usual.name)}.` };
            },
          };
        }
        const host = personOf(change.memberId);
        if (!host || !host.core) return fail('Gastgeber kann nur jemand aus der Stammtruppe sein.');
        if (current === host.id) return already(`Freitag (${day}) ist schon bei ${host.name}.`);
        const away = await absencesOverlapping(db, date, date);
        if (away.some((absence) => absence.memberId === host.id)) {
          return fail(`${host.name} ist am ${day} als weg eingetragen.`);
        }
        return {
          ok: true,
          what: `Freitag (${day}) zu ${host.name}`,
          apply: async () => {
            await setHost(db, date, host.id);
            const tell = host.id !== admin.id && host.phone;
            return {
              line: `Freitag (${day}) ist jetzt bei ${bold(host.name)}.${tell ? ` ${host.name} bekommt Bescheid.` : ''}`,
              messages: tell
                ? [
                    {
                      key: `hostset:${date}:${host.id}:${now.getTime()}`,
                      to: host.phone!,
                      text: `🏠 ${bold(`Freitag (${day}) bist du Gastgeber!`)} ${admin.name} hat dich eingetragen: Du bestellst, und das Geld geht an dich.\n${link(date)}`,
                    },
                  ]
                : [],
            };
          },
        };
      }

      case 'no_host': {
        const date = fridayOf(change);
        if (!isIsoDate(date)) return fail(date);
        const day = formatDayShort(date);
        if (!canClearHost(admin)) return fail('Einen Freitag ohne Gastgeber machen nur Admins.');
        if (await closed(date)) return fail(`Freitag (${day}) ist schon geschlossen.`);
        if ((await getFridayRow(db, date))?.noHost) {
          return already(`Freitag (${day}) ist schon bei niemandem.`);
        }
        return {
          ok: true,
          what: `Freitag (${day}) bei niemandem`,
          apply: async () => {
            await clearHost(db, date);
            const when = now >= berlinAt(date, -2, 12) ? 'gleich' : 'am Mittwoch';
            return {
              line: `Freitag (${day}) ist jetzt bei niemandem. Ich frag ${when} die Stammtruppe, wer übernimmt.`,
            };
          },
        };
      }

      case 'cancel':
      case 'uncancel': {
        const date = fridayOf(change);
        if (!isIsoDate(date)) return fail(date);
        const day = formatDayShort(date);
        if (await closed(date)) return fail(`Freitag (${day}) ist schon geschlossen.`);
        const cancelled = (await getFridayRow(db, date))?.cancelled ?? false;
        if (change.kind === 'uncancel') {
          if (!cancelled) return already(`Freitag (${day}) fällt gar nicht aus.`);
          return {
            ok: true,
            what: `Freitag (${day}) findet doch statt`,
            apply: async () => {
              await setCancelled(db, date, false, null);
              return { line: `Freitag (${day}) findet wieder statt.` };
            },
          };
        }
        if (cancelled) return already(`Freitag (${day}) fällt schon aus.`);
        const reason = change.text;
        return {
          ok: true,
          what: `Freitag (${day}) absagen${reason ? ` („${reason}“)` : ''}`,
          confirm: `Freitag (${day}) absagen: Alle bekommen dann eine Absage.`,
          apply: async () => {
            await setCancelled(db, date, true, reason);
            const when =
              now >= berlinAt(date, -2, 12) ? 'Alle bekommen gleich' : 'Ab Mittwoch bekommen alle';
            return { line: `Freitag (${day}) ist abgesagt. ${when} eine Absage.` };
          },
        };
      }

      case 'answer': {
        const date = fridayOf(change);
        if (!isIsoDate(date)) return fail(date);
        const day = formatDayShort(date);
        const target = people.find((person) => person.id === change.memberId) ?? null;
        if (!target) return fail('Die Person gibt es nicht.');
        const status = change.status;
        if (!status) return fail(`Für ${target.name} fehlt, ob dabei, ohne Essen oder raus.`);
        const view = await loadFriday(db, date, now);
        if (view.cancelled) return fail(`Freitag (${day}) fällt aus.`);
        if (view.locked || isPastDeadline(date, now)) {
          return fail(`Bestellschluss am ${day} ist vorbei, das geht nur noch auf der Seite.`);
        }
        const entry = view.participants.find((participant) => participant.member.id === target.id);
        const allowed = canEditOrderOf(
          admin,
          { id: target.id, addedById: entry?.addedById ?? null },
          view.host?.id ?? null,
          { locked: false, settled: view.settled }
        );
        if (!allowed) return fail(`${target.name} kann ich am ${day} nicht ändern.`);
        if (entry?.attendance.reason === 'answered' && entry.attendance.status === status) {
          return already(`${target.name} ist am ${day} schon ${STATUS_TEXT[status]}.`);
        }
        const orders = [
          ...(entry?.items ?? []),
          ...view.preorders.filter((item) => item.memberId === target.id),
        ];
        return {
          ok: true,
          what: `${target.name} am ${day}: ${STATUS_TEXT[status]}`,
          confirm:
            status !== 'in' && orders.length
              ? `Die Bestellung von ${target.name} am ${day} fliegt dabei raus.`
              : undefined,
          apply: async () => {
            await setAttendance(db, date, target.id, status, now);
            return { line: `${target.name} ist Freitag (${day}) ${STATUS_TEXT[status]}.` };
          },
        };
      }

      case 'absence': {
        const target = personOf(change.memberId);
        if (!target) return fail('Die Person gibt es nicht.');
        const from = change.fromDate ?? '';
        const to = change.toDate || from;
        if (!isIsoDate(from) || !isIsoDate(to)) {
          return fail(`Für ${target.name} fehlt, von wann bis wann.`);
        }
        if (to < from) return fail('Das Ende liegt vor dem Anfang.');
        if (to < today) return fail('Das liegt schon in der Vergangenheit.');
        const start = from < today ? today : from;
        if (daysBetween(start, to) > 366) return fail('So lange geht nur auf der Seite.');
        const range =
          start === to
            ? `am ${formatDayShort(start)}`
            : `vom ${formatDayShort(start)} bis ${formatDayShort(to)}`;
        return {
          ok: true,
          what: `${target.name} ${range} weg`,
          apply: async () => {
            await addAbsence(db, target.id, start, to, null);
            const hosting = await hostedFridaysBetween(db, target.id, start, to, now);
            return {
              line: `${target.name} ist ${range} als weg eingetragen.${
                hosting.length
                  ? ` Am ${formatDayList(hosting)} wäre ${target.name} Gastgeber: Trag jemand anderen ein, sonst frag ich die Stammtruppe, wer übernimmt.`
                  : ''
              }`,
            };
          },
        };
      }

      case 'message': {
        const target = personOf(change.memberId);
        if (!target?.phone) return fail('Die Person kann ich nicht anschreiben.');
        if (target.id === admin.id) return fail('An dich selbst schreib ich nicht.');
        const text = change.text?.trim();
        if (!text) return fail(`Was soll ich ${target.name} schreiben?`);
        return {
          ok: true,
          what: `Nachricht an ${target.name}`,
          apply: async () => ({
            line: `Nachricht an ${target.name} geht gleich raus: „${text}“`,
            messages: [
              {
                key: `adminmsg:${target.id}:${now.getTime()}:${index}`,
                to: target.phone!,
                text: `💬 ${bold(`Von ${admin.name}:`)} ${text}`,
              },
            ],
          }),
        };
      }
    }
  };

  const plans: Plan[] = [];
  for (const [index, change] of changes.entries()) {
    try {
      plans.push(await plan(change, index));
    } catch (error) {
      console.error('[admin] could not check a change', error);
      plans.push(fail('Das konnte ich gerade nicht prüfen.'));
    }
  }
  const lineOf = (entry: Extract<Plan, { ok: false }>) =>
    `${entry.done ? '👌' : '⚠️'} ${entry.line}`;
  const failed = plans.filter((entry) => !entry.ok);
  const ready = plans.filter((entry) => entry.ok);
  // Something that cannot be undone quietly waits for „sicher“, and so does everything else
  // in the message, so sending it again does not do the rest twice.
  const asks = ready.filter((entry) => entry.confirm);
  if (asks.length && !confirmed) {
    return {
      text: [
        ...failed.map(lineOf),
        bold('Das mach ich, sobald du’s bestätigst:'),
        ...ready.map((entry) => `• ${entry.what}`),
        ...asks.map((entry) => `❓ ${entry.confirm}`),
        `Passt das? Dann schick mir die Nachricht nochmal mit ${bold('sicher')} am Ende.`,
      ].join('\n'),
      messages: [],
    };
  }
  const lines = failed.map(lineOf);
  const messages: Outgoing[] = [];
  for (const entry of ready) {
    try {
      const done = await entry.apply();
      lines.push(`✅ ${done.line}`);
      messages.push(...(done.messages ?? []));
    } catch (error) {
      if (error instanceof ServiceError) {
        lines.push(`⚠️ ${entry.what}: ${error.message}.`);
        continue;
      }
      console.error('[admin] change failed', error);
      lines.push(`⚠️ ${entry.what} hat nicht geklappt.`);
    }
  }
  return { text: lines.join('\n') || 'Da war nichts zu ändern.', messages };
}
