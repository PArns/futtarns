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
  const lines = text
    .split('\n')
    .map((raw) => raw.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (lines.filter((line) => PRODUCT_INFO.test(line)).length >= 2) return parseLieferando(lines);
  return parseFreeText(text);
}

const NAME_MAX = 120;
const DESCRIPTION_MAX = 300;
const PRODUCT_INFO = /^produktinfo$/i;
const AFTER_INFO = /^(altersbeschränkung.*|\d+\+|nicht verfügbar)$/i;
const DEPOSIT = /zzgl\.\s*pfand\s*\((\d{1,3}[.,]\d{2})\s*€\)/i;

/**
 * Reads the text of a Lieferando menu page, copied with Ctrl+A or taken by the bookmarklet.
 * Every dish is its name followed by „Produktinfo“, then its price and its description;
 * the page prints category headings and descriptions twice in a row, and lists each
 * category once more in its menu bar, which is how a heading is told from a description.
 * Dishes from the „Beliebt“ section come again in their own category; the later one wins.
 */
function parseLieferando(raw: string[]): { dishes: BulkDish[]; errors: string[] } {
  const lines = raw.map((line) => line.replace(/^#+\s*/, ''));
  const isPair = (index: number) => lines[index] === lines[index + 1];
  const menuBar = new Set(
    lines.filter((line, index) => lines[index - 1] !== line && lines[index + 1] !== line)
  );
  const headingIn = (from: number, to: number) => {
    let found: string | null = null;
    let fallback: string | null = null;
    for (let index = from; index < to; index++) {
      if (!isPair(index)) continue;
      const text = lines[index]!;
      if (menuBar.has(text)) found = text;
      else if (text.length <= 40 && !text.endsWith('.')) fallback = text;
      index++;
    }
    return found ?? fallback;
  };

  const marks = lines.flatMap((line, index) =>
    PRODUCT_INFO.test(line) && index > 0 ? [index] : []
  );
  const byName = new Map<string, BulkDish>();
  const errors: string[] = [];
  let category: string | null = null;
  let end = 0;

  marks.forEach((mark, position) => {
    const nameAt = mark - 1;
    const nextNameAt = (marks[position + 1] ?? lines.length + 1) - 1;
    category = headingIn(end, nameAt) ?? category;
    const name = lines[nameAt]!.slice(0, NAME_MAX);

    let index = mark + 1;
    let unavailable = false;
    while (index < nextNameAt && AFTER_INFO.test(lines[index]!)) {
      if (/^nicht verfügbar$/i.test(lines[index]!)) unavailable = true;
      index++;
    }
    const prices: number[] = [];
    while (index < nextNameAt && PRICE_ONLY.test(lines[index]!)) {
      prices.push(parseEuroToCents(PRICE_ONLY.exec(lines[index]!)![1]!)!);
      index++;
    }

    let description: string | null = null;
    if (lines[index]?.startsWith('•')) {
      const bullets: string[] = [];
      for (; index < nextNameAt && lines[index]!.startsWith('•'); index++) {
        if (!lines[index]!.slice(1).includes('•')) bullets.push(lines[index]!.slice(1).trim());
      }
      description = bullets.join(', ');
    } else if (index + 1 < nextNameAt && isPair(index) && !menuBar.has(lines[index]!)) {
      description = lines[index]!;
      index += 2;
    }
    end = index;

    if (unavailable || prices.length === 0) {
      errors.push(`„${name}“ ist gerade nicht verfügbar`);
      return;
    }
    // A bottle's deposit is charged with it, so it belongs in the price.
    const deposit = lines.slice(index, nextNameAt).join(' ').match(DEPOSIT);
    byName.delete(name);
    byName.set(name, {
      category,
      name,
      // With a discount the page shows the current price first and the old one after it.
      priceCents: prices[0]! + (deposit ? parseEuroToCents(deposit[1]!)! : 0),
      description: description?.slice(0, DESCRIPTION_MAX) || null,
    });
  });

  return { dishes: [...byName.values()], errors };
}

function parseFreeText(text: string): { dishes: BulkDish[]; errors: string[] } {
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
        name: first.line.slice(0, NAME_MAX),
        priceCents: parseEuroToCents(priceOnly[1]!)!,
        description:
          rest
            .map((entry) => entry.line)
            .join(' ')
            .slice(0, DESCRIPTION_MAX) || null,
      });
      pending = [];
      return;
    }

    const inline = INLINE_PRICE.exec(line);
    const inlineCents = inline ? parseEuroToCents(inline[2]!.replace(/\s*€$/, '')) : null;
    if (inline && inline[1]!.trim() && inlineCents !== null && pending.length === 0) {
      dishes.push({
        category,
        name: inline[1]!
          .replace(/[–-]\s*$/, '')
          .trim()
          .slice(0, NAME_MAX),
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
