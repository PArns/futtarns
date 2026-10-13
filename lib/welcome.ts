import {
  DEADLINE_MINUTES_BEFORE,
  DELIVERY_MINUTES_AFTER_ORDER,
  ORDER_HOUR,
  ORDER_MINUTE,
} from '@/lib/dates';
import { bold } from '@/lib/messages';

function clock(minutesOfDay: number): string {
  return `${Math.floor(minutesOfDay / 60)}:${String(minutesOfDay % 60).padStart(2, '0')}`;
}

const order = ORDER_HOUR * 60 + ORDER_MINUTE;
const BOT_NOTE =
  '🤖 Kurz vorweg: Das hier ist eine automatische Nachricht. freitach ist unser Bot fürs Freitagsessen und schreibt über diese Nummer. Auf normale Nachrichten antwortet er nicht, nur auf die Befehle unten.';
const DEADLINE_LINE = `Bestellschluss ist freitags um ${bold(`${clock(order - DEADLINE_MINUTES_BEFORE)} Uhr`)}, danach kommt der Zahl-Link. Gegessen wird gegen ${clock(order + DELIVERY_MINUTES_AFTER_ORDER)}.`;
const HELP_LINE = `Mit ${bold('hilfe')} siehst du, was ich sonst noch kann.`;

/**
 * The WhatsApp message someone gets when they are added to the group. Outside the
 * Stammtruppe they only hear from the bot for the Fridays someone invites them to.
 */
export function welcomeText({
  name,
  invitedBy,
  link,
  core = true,
}: {
  name: string;
  invitedBy: string;
  link: string;
  core?: boolean;
}): string {
  return [
    `🍕 ${bold(`Hi ${name}, willkommen bei freitach!`)}`,
    '',
    BOT_NOTE,
    '',
    `${invitedBy} hat dich eingetragen. Hier läuft unser Freitagsessen: Wir bestellen jede Woche zusammen, du sagst nur, ob du dabei bist, und suchst dir was aus.`,
    '',
    `1️⃣ ${bold('Einmal anmelden:')}`,
    link,
    'Später reicht dafür deine Handynummer.',
    '',
    `2️⃣ ${bold('Standardgericht festlegen')}, pro Restaurant eins, dann musst du nicht jede Woche wählen.`,
    '',
    core
      ? `3️⃣ ${bold('Mittwochs')} frage ich hier, ob du kommst und wo wir bestellen, freitags um 10 noch mal, wenn du nichts gesagt hast. Antworte mit ${bold('1')}, ${bold('2')}, ${bold('3')} oder ${bold('wie immer')}.`
      : `3️⃣ Du bist als ${bold('Gast')} dabei: Ich frag dich nicht jede Woche. Hast du Lust, sag auf der Seite zu oder schick mir ${bold('1')} für den nächsten Freitag.`,
    '',
    DEADLINE_LINE,
    HELP_LINE,
  ].join('\n');
}

/** The WhatsApp message a known guest gets when someone invites them to another Friday. */
export function guestInviteText({
  name,
  invitedBy,
  day,
  host,
  link,
}: {
  name: string;
  invitedBy: string;
  day: string;
  host: string | null;
  link: string;
}): string {
  return [
    `🍕 ${bold(`Hi ${name}, du bist eingeladen!`)}`,
    `${invitedBy} hat dich für ${bold(`Freitag (${day})`)} zum Freitagsessen${host ? ` bei ${host}` : ''} eingetragen. Such dir was aus, oder antworte mit ${bold('3')}, wenn du doch nicht kannst:`,
    link,
  ].join('\n');
}

/** The WhatsApp message a guest gets when someone invites them to one Friday. */
export function guestWelcomeText({
  name,
  invitedBy,
  day,
  host,
  link,
}: {
  name: string;
  invitedBy: string;
  /** `16. Okt.` */
  day: string;
  host: string | null;
  link: string;
}): string {
  return [
    `🍕 ${bold(`Hi ${name}, du bist eingeladen!`)}`,
    '',
    BOT_NOTE,
    '',
    `${invitedBy} hat dich für ${bold(`Freitag (${day})`)} zum Freitagsessen${host ? ` bei ${host}` : ''} eingetragen. Wir bestellen zusammen, du suchst dir einfach was aus. Läuft gerade die Restaurantwahl, stimmst du mit ab.`,
    '',
    `1️⃣ ${bold('Anmelden und aussuchen:')}`,
    link,
    'Später reicht dafür deine Handynummer.',
    '',
    `2️⃣ Kannst du doch nicht? Antworte mit ${bold('3')}.`,
    '',
    `3️⃣ Du bleibst als Gast eingetragen. Willst du an einem anderen Freitag dazukommen, sag auf der Seite zu oder schick mir in der Woche ${bold('1')}.`,
    '',
    DEADLINE_LINE,
    HELP_LINE,
  ].join('\n');
}
