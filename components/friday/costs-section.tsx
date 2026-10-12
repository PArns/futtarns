import { TriangleAlert } from 'lucide-react';
import { AmountRow } from '@/components/ui/amount-row';
import { GlassCard } from '@/components/ui/glass-card';
import { Notice } from '@/components/ui/notice';
import { formatEuro } from '@/lib/format';
import type { FridayView } from '@/lib/services/fridays';
import { cn } from '@/lib/utils';

/** What the Friday costs in total and what everyone pays and still owes. */
export function CostsSection({ view }: { view: FridayView }) {
  const flat = view.mode === 'flat';
  const estimate = view.estimate;
  const rows = view.participants.filter(
    (entry) => entry.share || entry.money.dueCents !== 0 || entry.money.paidCents !== 0
  );
  const eaters = view.shares.length;
  const feesEach = !flat && estimate && eaters > 0 ? Math.round(estimate.sharedCents / eaters) : 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
      <GlassCard variant="tile" className="p-5">
        <dl className="space-y-2 text-sm">
          {flat ? (
            <AmountRow
              label={`${eaters} × ${formatEuro(view.flatPriceCents ?? 0)}`}
              cents={eaters * (view.flatPriceCents ?? 0)}
              emphasis="strong"
            />
          ) : (
            estimate && (
              <>
                <AmountRow label="Gerichte" cents={estimate.subtotalCents} />
                <AmountRow label="Liefergebühr" cents={estimate.deliveryFeeCents} />
                <AmountRow label="Servicegebühr" cents={estimate.serviceFeeCents} />
                <AmountRow label="Trinkgeld" cents={estimate.tipCents} />
                <div className="border-border/60 border-t pt-2">
                  <AmountRow
                    label={view.finalTotalCents !== null ? 'Geschätzt' : 'Summe'}
                    cents={estimate.totalCents}
                    emphasis={view.finalTotalCents === null ? 'strong' : 'muted'}
                  />
                </div>
                {view.finalTotalCents !== null && (
                  <AmountRow
                    label="Wirklich bezahlt"
                    cents={view.finalTotalCents}
                    emphasis="strong"
                  />
                )}
                {eaters > 0 && (
                  <p className="text-muted-foreground pt-1 text-xs">
                    Gebühren und Trinkgeld teilen sich alle, die essen: etwa {formatEuro(feesEach)}{' '}
                    pro Person.
                  </p>
                )}
              </>
            )
          )}
          {view.drinksTotalCents > 0 && (
            <div className="border-border/60 border-t pt-2">
              <AmountRow
                label={`Getränke (${Math.round(view.drinksTotalCents / view.drinksFeeCents)} × ${formatEuro(view.drinksFeeCents)})`}
                cents={view.drinksTotalCents}
                emphasis="muted"
              />
            </div>
          )}
        </dl>
        {!flat && estimate && estimate.missingForMinimumCents > 0 && estimate.subtotalCents > 0 && (
          <Notice className="text-warning mt-4 flex items-start gap-2 font-semibold">
            <TriangleAlert />
            Es fehlen noch {formatEuro(estimate.missingForMinimumCents)} bis zum Mindestbestellwert.
          </Notice>
        )}
      </GlassCard>

      <GlassCard variant="tile" className="p-4 sm:p-5">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Noch ist niemand mit Essen dabei.</p>
        ) : (
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs">
                <th className="w-[34%] pb-2 text-left font-medium">Wer</th>
                <th className="pb-2 text-right font-medium">{flat ? 'Pauschale' : 'Essen'}</th>
                <th className="pb-2 text-right font-medium">Getränke</th>
                <th className="pb-2 text-right font-medium">Offen</th>
              </tr>
            </thead>
            <tbody className="divide-border/50 divide-y">
              {rows.map((entry) => {
                const isHost = entry.member.id === view.host?.id;
                return (
                  <tr key={entry.member.id}>
                    <td className="truncate py-2 pr-2 font-medium">{entry.member.name}</td>
                    <td className="py-2 text-right tabular-nums">
                      {entry.share ? formatEuro(entry.share.totalCents) : '–'}
                    </td>
                    <td className="text-muted-foreground py-2 text-right tabular-nums">
                      {entry.money.drinksCents ? formatEuro(entry.money.drinksCents) : '–'}
                    </td>
                    <td
                      className={cn(
                        'py-2 text-right font-bold tabular-nums',
                        entry.money.openCents > 0 && 'text-warning',
                        entry.money.openCents < 0 && 'text-primary',
                        isHost && 'text-muted-foreground text-xs font-medium'
                      )}
                    >
                      {isHost ? 'Gastgeber' : formatEuro(entry.money.openCents)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </GlassCard>
    </div>
  );
}
