import type { OrderItem } from '@/lib/db/schema';

export type OrderLine = {
  key: string;
  count: number;
  name: string;
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
    'dishId' | 'name' | 'options' | 'note' | 'quantity' | 'unitPriceCents' | 'memberId'
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
  return [...lines.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function orderSheetText(lines: OrderLine[]): string {
  return lines
    .map((line) => {
      const details = [...line.options, ...line.notes.map((note) => `Notiz: ${note}`)];
      return `${line.count}× ${line.name}${details.length ? ` (${details.join(', ')})` : ''} – ${line.people.join(', ')}`;
    })
    .join('\n');
}
