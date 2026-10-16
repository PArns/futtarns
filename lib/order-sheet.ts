import type { OrderItem } from '@/lib/db/schema';

export type OrderLine = {
  key: string;
  count: number;
  name: string;
  /** The menu category, so the host finds the dish in Lieferando's menu. */
  category: string | null;
  options: string[];
  notes: string[];
  people: string[];
  unitPriceCents: number;
};

function optionLabels(item: Pick<OrderItem, 'options'>): string[] {
  return item.options.map((option) => `${option.groupName}: ${option.choiceName}`);
}

/**
 * Folds everyone's items into the lines the host types into Lieferando: identical dishes
 * with identical options are one line with a count, notes stay attached.
 */
export function buildOrderSheet(
  items: Pick<
    OrderItem,
    'dishId' | 'name' | 'category' | 'options' | 'note' | 'quantity' | 'unitPriceCents' | 'memberId'
  >[],
  nameOf: (memberId: number) => string
): OrderLine[] {
  const lines = new Map<string, OrderLine>();
  for (const item of items) {
    const options = optionLabels(item);
    const key = [item.dishId ?? item.name, ...options.sort(), item.note ?? ''].join('|');
    const line = lines.get(key) ?? {
      key,
      count: 0,
      name: item.name,
      category: item.category,
      options,
      notes: item.note ? [item.note] : [],
      people: [],
      unitPriceCents: item.unitPriceCents,
    };
    line.count += item.quantity;
    const person = nameOf(item.memberId);
    if (!line.people.includes(person)) line.people.push(person);
    lines.set(key, line);
  }
  // Lines without a category go last, the way the menu lists them under „Sonstiges“.
  return [...lines.values()].sort(
    (a, b) =>
      Number(a.category === null) - Number(b.category === null) ||
      (a.category ?? '').localeCompare(b.category ?? '', 'de') ||
      a.name.localeCompare(b.name, 'de')
  );
}

/**
 * The order split by when it is eaten: what goes in the order now, and the dishes of those
 * who come later („Ich komm später“), which the host may order later. Their names carry the
 * time they come.
 */
export function sheetsByArrival(
  participants: {
    items: Parameters<typeof buildOrderSheet>[0];
    late: boolean;
    arrivesAt: string | null;
  }[],
  nameOf: (memberId: number) => string
): { now: OrderLine[]; later: OrderLine[] } {
  const late = participants.filter((entry) => entry.late);
  const arrival = new Map(
    late.flatMap((entry) => entry.items.map((item) => [item.memberId, entry.arrivesAt] as const))
  );
  return {
    now: buildOrderSheet(
      participants.filter((entry) => !entry.late).flatMap((entry) => entry.items),
      nameOf
    ),
    later: buildOrderSheet(
      late.flatMap((entry) => entry.items),
      (memberId) => {
        const at = arrival.get(memberId);
        return at ? `${nameOf(memberId)} (~${at})` : nameOf(memberId);
      }
    ),
  };
}

/** The order list as text, one block per menu category. */
export function orderSheetText(lines: OrderLine[]): string {
  const text: string[] = [];
  let category: string | null | undefined;
  for (const line of lines) {
    if (line.category !== category && lines.some((other) => other.category)) {
      if (text.length) text.push('');
      text.push(`${line.category ?? 'Sonstiges'}:`);
    }
    category = line.category;
    const details = [...line.options, ...line.notes.map((note) => `Notiz: ${note}`)];
    text.push(
      `${line.count}× ${line.name}${details.length ? ` (${details.join(', ')})` : ''} – ${line.people.join(', ')}`
    );
  }
  return text.join('\n');
}
