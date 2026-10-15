import { ChevronUp } from 'lucide-react';
import { formatEuro } from '@/lib/format';

/**
 * On phones the viewer's order and amount stay in view at the bottom while they scroll
 * the menu; a tap jumps to „Deine Bestellung“.
 */
export function OrderBar({
  summary,
  amountCents,
  amountLabel,
}: {
  /** What they get, e.g. `Margherita, Tiramisu` or `Noch nichts ausgesucht`. */
  summary: string;
  amountCents: number;
  /** `bis jetzt`, `offen` or `bezahlt`. */
  amountLabel: string;
}) {
  return (
    <a
      href="#bestellung"
      className="bg-background/90 border-border fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:hidden"
    >
      <span className="min-w-0 flex-1">
        <span className="text-muted-foreground block text-[11px] font-semibold tracking-wider uppercase">
          Deine Bestellung
        </span>
        <span className="block truncate text-sm font-semibold">{summary}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-extrabold tabular-nums">
          {formatEuro(amountCents)}
        </span>
        <span className="text-muted-foreground block text-[11px]">{amountLabel}</span>
      </span>
      <ChevronUp className="text-primary size-5 shrink-0" />
    </a>
  );
}
