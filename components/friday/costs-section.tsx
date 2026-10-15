import {
  CupSoda,
  HandCoins,
  Receipt,
  ShoppingBag,
  Ticket,
  TriangleAlert,
  Truck,
  UtensilsCrossed,
} from 'lucide-react';
import { AmountRow } from '@/components/ui/amount-row';
import { Badge } from '@/components/ui/badge';
import { GlassCard } from '@/components/ui/glass-card';
import { Notice } from '@/components/ui/notice';
import { formatEuro } from '@/lib/format';
import type { Money } from '@/lib/balance';
import type { FridayView } from '@/lib/services/fridays';

/**
 * Where someone stands: until paying opens just the amount so far; then amber still owes,
 * green has paid it all, blue gets money back. Whoever collects and owes nothing (the host,
 * whoever fetches the food) gets their role instead.
 */
function MoneyPill({
  money,
  role,
  payable,
}: {
  money: Money;
  role: string | null;
  payable: boolean;
}) {
  if (role && money.dueCents === 0 && money.paidCents === 0) {
    return <span className="text-muted-foreground text-xs">{role}</span>;
  }
  const open = money.openCents;
  if (open > 0 && !payable) {
    return <span className="font-semibold tabular-nums">{formatEuro(open)}</span>;
  }
  if (open > 0)
    return (
      <Badge variant="softWarning" className="tabular-nums">
        {formatEuro(open)}
      </Badge>
    );
  if (open < 0)
    return (
      <Badge variant="soft" className="tabular-nums">
        +{formatEuro(-open)}
      </Badge>
    );
  if (money.paidCents > 0) return <Badge variant="softSuccess">bezahlt</Badge>;
  return <span className="text-muted-foreground">–</span>;
}

/** What the Friday costs in total and what everyone pays and still owes. */
export function CostsSection({
  view,
  payable,
  aheadOnly = [],
}: {
  view: FridayView;
  payable: boolean;
  /** Who ordered only ahead, with roughly what that comes to if its restaurant wins. */
  aheadOnly?: { memberId: number; name: string; restaurant: string; cents: number }[];
}) {
  const flat = view.mode === 'flat';
  const estimate = view.estimate;
  const rows = view.participants.filter(
    (entry) => entry.share || entry.money.dueCents !== 0 || entry.money.paidCents !== 0
  );
  const eaters = view.shares.length;
  const feesEach = !flat && estimate && eaters > 0 ? Math.round(estimate.sharedCents / eaters) : 0;

  const drinkers =
    view.drinksFeeCents > 0 ? Math.round(view.drinksTotalCents / view.drinksFeeCents) : 0;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-4">
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
                  <AmountRow
                    icon={UtensilsCrossed}
                    label="Gerichte"
                    cents={estimate.subtotalCents}
                  />
                  {view.pickup ? (
                    <AmountRow
                      icon={ShoppingBag}
                      label={`Abholen${view.picker ? ` (${view.picker.name})` : ''}`}
                      cents={0}
                    />
                  ) : (
                    <>
                      <AmountRow
                        icon={Truck}
                        label="Liefergebühr"
                        cents={estimate.deliveryFeeCents}
                      />
                      <AmountRow
                        icon={Receipt}
                        label="Servicegebühr (Lieferando)"
                        cents={estimate.serviceFeeCents}
                      />
                      <AmountRow icon={HandCoins} label="Trinkgeld" cents={estimate.tipCents} />
                    </>
                  )}
                  {estimate.voucherCents > 0 && (
                    <AmountRow icon={Ticket} label="Gutschein" cents={-estimate.voucherCents} />
                  )}
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
                  {view.pickup && (
                    <p className="text-muted-foreground pt-1 text-xs">
                      Abgeholt kostet es nur die Gerichte: keine Liefer- oder Servicegebühr, kein
                      Trinkgeld. {view.picker?.name ?? 'Wer abholt'} zahlt im Restaurant und bekommt
                      das Geld fürs Essen
                      {view.host && view.picker?.id !== view.host.id
                        ? `, die Getränke gehen an ${view.host.name}`
                        : ''}
                      .
                    </p>
                  )}
                  {!view.pickup && eaters > 0 && (
                    <p className="text-muted-foreground pt-1 text-xs">
                      {estimate.voucherCents > 0
                        ? 'Gebühren, Trinkgeld und Gutschein'
                        : 'Gebühren und Trinkgeld'}{' '}
                      teilen sich alle, die essen: {view.settled ? '' : 'etwa '}
                      {formatEuro(feesEach)} pro Person. Die Servicegebühr ist die Systemgebühr von
                      Lieferando, nicht unsere.
                    </p>
                  )}
                </>
              )
            )}
          </dl>
          {!flat &&
            estimate &&
            estimate.missingForMinimumCents > 0 &&
            estimate.subtotalCents > 0 && (
              <Notice className="text-warning mt-4 flex items-start gap-2 font-semibold">
                <TriangleAlert />
                Es fehlen noch {formatEuro(estimate.missingForMinimumCents)} bis zum
                Mindestbestellwert.
              </Notice>
            )}
        </GlassCard>

        {view.drinksFeeCents > 0 && (
          <GlassCard variant="tile" className="flex items-start gap-3 p-5 text-sm">
            <CupSoda className="text-primary mt-0.5 size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-3 font-semibold">
                <span>Getränkekasse</span>
                <span className="tabular-nums">{formatEuro(view.drinksTotalCents)}</span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {formatEuro(view.drinksFeeCents)} pro Person, die kommt, freiwillig. Für Cola und
                Co., geht an {view.host?.name ?? 'den Gastgeber'}
                {flat ? '.' : ' und nicht an Lieferando.'}
              </p>
              <p className="mt-1 text-xs font-medium">
                {drinkers > 0
                  ? `${drinkers} × ${formatEuro(view.drinksFeeCents)}${view.settled ? '' : ' bisher'}`
                  : 'Bisher zahlt noch keiner ein.'}
              </p>
            </div>
          </GlassCard>
        )}
      </div>

      <GlassCard variant="tile" className="p-4 sm:p-5">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Noch ist niemand mit Essen dabei.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs">
                <th className="pb-2 text-left font-medium">Wer</th>
                <th className="w-px pb-2 pl-2 text-right font-medium">
                  {flat ? 'Pauschale' : 'Essen'}
                </th>
                <th className="w-px pb-2 pl-2 text-right font-medium">Getränke</th>
                <th className="w-px pb-2 pl-2 text-right font-medium whitespace-nowrap">
                  {payable ? 'Offen' : 'Bis jetzt'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border/50 divide-y">
              {rows.map((entry) => {
                const role =
                  entry.member.id === view.host?.id
                    ? 'Gastgeber'
                    : view.pickup && entry.member.id === view.picker?.id
                      ? 'holt ab'
                      : null;
                return (
                  <tr key={entry.member.id}>
                    <td className="py-2 font-medium break-words">{entry.member.name}</td>
                    <td className="py-2 pl-2 text-right whitespace-nowrap tabular-nums">
                      {entry.share ? formatEuro(entry.share.totalCents) : '–'}
                    </td>
                    <td className="text-muted-foreground py-2 pl-2 text-right whitespace-nowrap tabular-nums">
                      {entry.money.drinksCents ? formatEuro(entry.money.drinksCents) : '–'}
                    </td>
                    <td className="py-2 pl-2 text-right whitespace-nowrap">
                      <MoneyPill money={entry.money} role={role} payable={payable} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {aheadOnly.length > 0 && (
          <ul className="text-muted-foreground border-border/50 mt-2 space-y-1 border-t pt-2 text-xs">
            {aheadOnly.map((entry) => (
              <li key={entry.memberId} className="flex justify-between gap-3">
                <span>
                  {entry.name}: nur vorbestellt, falls {entry.restaurant} gewinnt
                </span>
                <span className="tabular-nums">~{formatEuro(entry.cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
