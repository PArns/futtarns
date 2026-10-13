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

/** The WhatsApp message someone gets when they are added to the group. */
export function welcomeText({
  name,
  invitedBy,
  link,
}: {
  name: string;
  invitedBy: string;
  link: string;
}): string {
  const order = ORDER_HOUR * 60 + ORDER_MINUTE;
  return [
    `🍕 ${bold(`Hi ${name}, willkommen bei freitach!`)}`,
    '',
    '🤖 Kurz vorweg: Das hier ist eine automatische Nachricht. freitach ist unser Bot fürs Freitagsessen und schreibt über diese Nummer. Auf normale Nachrichten antwortet er nicht, nur auf die Befehle unten.',
    '',
    `${invitedBy} hat dich eingetragen. Hier läuft unser Freitagsessen: Wir bestellen jede Woche zusammen, du sagst nur, ob du dabei bist, und suchst dir was aus.`,
    '',
    `1️⃣ ${bold('Einmal anmelden:')}`,
    link,
    'Später reicht dafür deine Handynummer.',
    '',
    `2️⃣ ${bold('Standardgericht festlegen')}, pro Restaurant eins, dann musst du nicht jede Woche wählen.`,
    '',
    `3️⃣ ${bold('Mittwochs')} frage ich hier, ob du kommst und wo wir bestellen, freitags um 10 noch mal, wenn du nichts gesagt hast. Antworte mit ${bold('1')}, ${bold('2')}, ${bold('3')} oder ${bold('wie immer')}.`,
    '',
    `Bestellschluss ist freitags um ${bold(`${clock(order - DEADLINE_MINUTES_BEFORE)} Uhr`)}, danach kommt der Zahl-Link. Gegessen wird gegen ${clock(order + DELIVERY_MINUTES_AFTER_ORDER)}.`,
    `Mit ${bold('hilfe')} siehst du, was ich sonst noch kann.`,
  ].join('\n');
}
