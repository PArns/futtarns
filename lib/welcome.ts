import {
  DEADLINE_MINUTES_BEFORE,
  DELIVERY_MINUTES_AFTER_ORDER,
  ORDER_HOUR,
  ORDER_MINUTE,
} from '@/lib/dates';

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
    `🍕 Hi ${name}, willkommen bei freitach!`,
    '',
    `${invitedBy} hat dich eingetragen. Hier läuft unser Freitagsessen: Wir bestellen jede Woche zusammen, du sagst nur, ob du dabei bist, und suchst dir was aus.`,
    '',
    `1️⃣ Einmal anmelden: ${link}`,
    '   Später reicht dafür deine Handynummer.',
    '2️⃣ Pro Restaurant ein Standardgericht festlegen, dann musst du nicht jede Woche wählen.',
    '3️⃣ Mittwochs frage ich hier, ob du kommst. Antworte einfach mit 1, 2 oder 3.',
    '',
    `Bestellschluss ist freitags um ${clock(order - DEADLINE_MINUTES_BEFORE)} Uhr, gegessen wird gegen ${clock(order + DELIVERY_MINUTES_AFTER_ORDER)}.`,
    'Mit „hilfe“ siehst du, was ich sonst noch kann.',
  ].join('\n');
}
