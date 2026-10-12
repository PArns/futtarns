import { parseEuroToCents } from '@/lib/menu/options';

export type BulkDish = {
  category: string | null;
  name: string;
  priceCents: number;
  description: string | null;
};

// A price at the end of a line needs cents or a € sign, so „Menü 1“ or „Box 8“ stay names.
const INLINE_PRICE =
  /^(.*?)\s+[–-]?\s*(?:ab\s+)?(\d{1,3}[.,]\d{2}\s*€?|\d{1,3}\s*€)\s*(?:\|\s*(.*))?$/;
const PRICE_ONLY = /^(?:ab\s+)?(\d{1,3}(?:[.,]\d{2}))\s*€$/i;
// Lines a copied delivery page is full of that never name a dish.
const NOISE =
  /^(beliebt|neu|vegan|vegetarisch|scharf|produktinfo|allergene.*|zusatzstoffe.*|\+|hinzufügen|mehr anzeigen|(mindestbestellwert|liefergebühr|lieferkosten|servicegebühr|kostenlose lieferung|gratis lieferung|\d+ bewertungen?).*)$/i;

/**
 * Reads a menu typed or pasted as text. Two shapes work and can be mixed:
 * - typed: `# Pizza` starts a category, then `Margherita 8,50 | Tomate, Mozzarella`;
 * - copied from a delivery site: a dish name, optional description lines, and the price
 *   on a line of its own (`8,50 €`).
 * Anything it cannot place is reported per line, so the preview can show it.
 */
export function parseBulkDishes(text: string): { dishes: BulkDish[]; errors: string[] } {
  const dishes: BulkDish[] = [];
  const errors: string[] = [];
  let category: string | null = null;
  let pending: { line: string; number: number }[] = [];

  const flushAsErrors = () => {
    for (const entry of pending) {
      errors.push(`Zeile ${entry.number}: „${entry.line}“ hat keinen Preis`);
    }
    pending = [];
  };

  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\s+/g, ' ').trim();
    const number = index + 1;
    if (!line || NOISE.test(line)) return;

    if (line.startsWith('#')) {
      flushAsErrors();
      category = line.replace(/^#+/, '').trim() || null;
      return;
    }

    const priceOnly = PRICE_ONLY.exec(line);
    if (priceOnly) {
      const [first, ...rest] = pending;
      if (!first) {
        errors.push(`Zeile ${number}: Preis ohne Gericht davor`);
        return;
      }
      dishes.push({
        category,
        name: first.line,
        priceCents: parseEuroToCents(priceOnly[1]!)!,
        description:
          rest
            .map((entry) => entry.line)
            .join(' ')
            .slice(0, 300) || null,
      });
      pending = [];
      return;
    }

    const inline = INLINE_PRICE.exec(line);
    const inlineCents = inline ? parseEuroToCents(inline[2]!.replace(/\s*€$/, '')) : null;
    if (inline && inline[1]!.trim() && inlineCents !== null && pending.length === 0) {
      dishes.push({
        category,
        name: inline[1]!.replace(/[–-]\s*$/, '').trim(),
        priceCents: inlineCents,
        description: inline[3]?.trim() || null,
      });
      return;
    }

    pending.push({ line, number });
  });

  flushAsErrors();
  return { dishes, errors };
}
