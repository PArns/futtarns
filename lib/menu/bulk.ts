import { parseEuroToCents } from '@/lib/menu/options';

export type BulkDish = {
  category: string | null;
  name: string;
  priceCents: number;
  description: string | null;
};

const DISH_LINE = /^(.*?)\s+(\d+(?:[.,]\d{1,2})?)\s*€?\s*(?:\|\s*(.*))?$/;

/**
 * Reads a menu typed or pasted as text: `# Pizza` starts a category, every other line is
 * `Name Preis` with an optional `| Beschreibung`, e.g. `Margherita 8,50 | Tomate, Mozzarella`.
 */
export function parseBulkDishes(text: string): { dishes: BulkDish[]; errors: string[] } {
  const dishes: BulkDish[] = [];
  const errors: string[] = [];
  let category: string | null = null;

  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith('#')) {
      category = line.replace(/^#+/, '').trim() || null;
      return;
    }
    const match = DISH_LINE.exec(line);
    const priceCents = match ? parseEuroToCents(match[2]!) : null;
    if (!match || !match[1]!.trim() || priceCents === null) {
      errors.push(`Zeile ${index + 1}: erwartet „Name Preis“, z. B. „Margherita 8,50“`);
      return;
    }
    dishes.push({
      category,
      name: match[1]!.trim(),
      priceCents,
      description: match[3]?.trim() || null,
    });
  });

  return { dishes, errors };
}
