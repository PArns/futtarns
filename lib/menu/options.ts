export type OptionChoice = { id: string; name: string; priceCents: number };

export type OptionGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  choices: OptionChoice[];
};

export type SelectedOption = {
  groupId: string;
  groupName: string;
  choiceId: string;
  choiceName: string;
  priceCents: number;
};

/** Turns a label into a stable id for an option group or choice. */
export function optionId(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'x'
  );
}

/** Parses a euro amount as typed by a German user ("2,50", "2.5", "+1") into cents. */
export function parseEuroToCents(input: string): number | null {
  const cleaned = input.trim().replace(/€/g, '').replace(/\s/g, '');
  if (!/^[+-]?\d+([.,]\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.replace(',', '.').split('.');
  const sign = whole!.startsWith('-') ? -1 : 1;
  const euros = Math.abs(Number(whole));
  return sign * (euros * 100 + Number(fraction.padEnd(2, '0')));
}

const GROUP_LINE = /^(.+?)\s*(?:\((\d+)(?:\s*-\s*(\d+))?\))?\s*:\s*(.+)$/;

/**
 * Parses the compact option editor format, one group per line:
 * `Größe (1): Klein | Groß +2,50` or `Extras (0-3): Käse +1 | Salami +1,50`.
 * `(1)` means exactly one, `(0-3)` a range; without it any number may be picked.
 */
export function parseOptionGroups(text: string): { groups: OptionGroup[]; errors: string[] } {
  const groups: OptionGroup[] = [];
  const errors: string[] = [];
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  lines.forEach((line, lineIndex) => {
    const match = GROUP_LINE.exec(line);
    if (!match) {
      errors.push(`Zeile ${lineIndex + 1}: erwartet „Name (min-max): Auswahl | Auswahl +Preis“`);
      return;
    }
    const [, rawName, rawMin, rawMax, rawChoices] = match;
    const name = rawName!.trim();
    const choices: OptionChoice[] = [];
    for (const rawChoice of rawChoices!.split('|')) {
      const part = rawChoice.trim();
      if (!part) continue;
      const priceMatch = /^(.*?)\s+([+-]\s*\d+(?:[.,]\d{1,2})?)\s*€?$/.exec(part);
      const choiceName = (priceMatch ? priceMatch[1]! : part).trim();
      const priceCents = priceMatch ? parseEuroToCents(priceMatch[2]!.replace(/\s/g, '')) : 0;
      if (priceCents === null) {
        errors.push(`Zeile ${lineIndex + 1}: Preis bei „${part}“ nicht lesbar`);
        continue;
      }
      choices.push({ id: uniqueId(choiceName, choices), name: choiceName, priceCents });
    }
    if (choices.length === 0) {
      errors.push(`Zeile ${lineIndex + 1}: keine Auswahl angegeben`);
      return;
    }
    const min = rawMin === undefined ? 0 : Number(rawMin);
    const max = rawMax !== undefined ? Number(rawMax) : rawMin !== undefined ? min : choices.length;
    if (max < min || max === 0) {
      errors.push(`Zeile ${lineIndex + 1}: Anzahl ${min}-${max} ergibt keinen Sinn`);
      return;
    }
    groups.push({
      id: uniqueId(name, groups),
      name,
      min,
      max: Math.min(max, choices.length),
      choices,
    });
  });

  return { groups, errors };
}

function uniqueId(label: string, existing: { id: string }[]): string {
  const base = optionId(label);
  let id = base;
  for (let n = 2; existing.some((entry) => entry.id === id); n++) id = `${base}-${n}`;
  return id;
}

/** Writes option groups back into the editor format that `parseOptionGroups` reads. */
export function formatOptionGroups(groups: OptionGroup[]): string {
  return groups
    .map((group) => {
      const count =
        group.min === group.max
          ? `(${group.min})`
          : group.min === 0 && group.max === group.choices.length
            ? ''
            : `(${group.min}-${group.max})`;
      const choices = group.choices
        .map((choice) =>
          choice.priceCents === 0
            ? choice.name
            : `${choice.name} ${choice.priceCents > 0 ? '+' : '-'}${formatPlainEuro(Math.abs(choice.priceCents))}`
        )
        .join(' | ');
      return `${group.name}${count ? ` ${count}` : ''}: ${choices}`;
    })
    .join('\n');
}

function formatPlainEuro(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}

/**
 * Checks a selection of choice ids against a dish's option groups and returns the
 * snapshot that is stored with the order, or the first rule it breaks.
 */
export function resolveSelection(
  groups: OptionGroup[],
  selection: Record<string, string[]>
): { ok: true; options: SelectedOption[] } | { ok: false; error: string } {
  const options: SelectedOption[] = [];
  for (const groupId of Object.keys(selection)) {
    if (!groups.some((group) => group.id === groupId)) {
      return { ok: false, error: `Unbekannte Optionsgruppe „${groupId}“` };
    }
  }
  for (const group of groups) {
    const picked = [...new Set(selection[group.id] ?? [])];
    if (picked.length < group.min || picked.length > group.max) {
      const range = group.min === group.max ? `${group.min}` : `${group.min} bis ${group.max}`;
      return { ok: false, error: `Bei „${group.name}“ bitte ${range} auswählen` };
    }
    for (const choiceId of picked) {
      const choice = group.choices.find((entry) => entry.id === choiceId);
      if (!choice) return { ok: false, error: `Unbekannte Auswahl bei „${group.name}“` };
      options.push({
        groupId: group.id,
        groupName: group.name,
        choiceId: choice.id,
        choiceName: choice.name,
        priceCents: choice.priceCents,
      });
    }
  }
  return { ok: true, options };
}

/** Price of one unit of a dish with the given options. */
export function unitPriceCents(basePriceCents: number, options: SelectedOption[]): number {
  return options.reduce((sum, option) => sum + option.priceCents, basePriceCents);
}
