import { Flame, Receipt, Settings2, ShoppingBag, Store, Ticket } from 'lucide-react';
import { CopyButton } from '@/components/common/copy-button';
import { ExtrasForm } from '@/components/friday/extras-form';
import { FlatForm } from '@/components/friday/flat-form';
import {
  CancelToggle,
  HostPicker,
  NoteEditor,
  PickupPicker,
  RestaurantPicker,
} from '@/components/friday/host-tools';
import { SettleForm } from '@/components/friday/settle-form';
import { UpcomingMessages, type UpcomingMessage } from '@/components/friday/upcoming-messages';
import { GlassCard } from '@/components/ui/glass-card';
import { Notice } from '@/components/ui/notice';
import { DRINKS_FEE_CENTS } from '@/lib/balance';
import { centsToInput, formatEuro } from '@/lib/format';
import { DEFAULT_TIP_CENTS } from '@/lib/pricing';
import type { OrderLine } from '@/lib/order-sheet';
import { orderSheetText } from '@/lib/order-sheet';
import type { FridayView, Participant } from '@/lib/services/fridays';

/**
 * What only the host and admins see: setting the Friday up on the left, what comes of it
 * (the order list, settling, the messages still to go out) on the right.
 */
export function HostSection({
  view,
  closed,
  sheet,
  sheetFor,
  hungry,
  restaurants,
  members,
  defaultHostName,
  viewerIsHost,
  messages,
  serverNow,
  voting,
  whatsappDown,
}: {
  view: FridayView;
  closed: boolean;
  sheet: OrderLine[];
  /** The restaurant ahead in the vote, when the list is the one it would get. */
  sheetFor: string | null;
  hungry: Participant[];
  restaurants: { id: number; name: string; isDefault: boolean }[];
  members: { id: number; name: string }[];
  defaultHostName: string | null;
  viewerIsHost: boolean;
  messages: UpcomingMessage[];
  serverNow: number;
  /** The group is still voting on the restaurant. */
  voting: boolean;
  /** The bot is not linked to WhatsApp, so nothing goes out right now. */
  whatsappDown: boolean;
}) {
  const flat = view.mode === 'flat';
  const hasOrders = sheet.length > 0;
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        {!view.cancelled && (
          <GlassCard variant="tile" className="space-y-4 p-5">
            <h3 className="flex items-center gap-2 font-bold">
              <Store className="text-primary size-4" /> Was gibt’s?
            </h3>
            <RestaurantPicker
              date={view.date}
              restaurantId={view.restaurant?.id ?? null}
              restaurants={restaurants}
              hasOrders={hasOrders}
              disabled={view.settled}
              voting={voting}
            />
            {!flat && view.restaurant?.pickup && (
              <PickupPicker
                date={view.date}
                pickup={view.pickup}
                pickerId={view.picker && view.picker.id !== view.host?.id ? view.picker.id : null}
                hostId={view.host?.id ?? null}
                hostName={view.host?.name ?? 'Gastgeber'}
                members={members}
                disabled={view.settled}
                delivers={view.restaurantDelivers}
              />
            )}
            <details className="border-border/60 rounded-xl border p-3" open={flat}>
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
                <Flame className="text-primary size-4" /> Oder Pauschale, z. B. Grillen
              </summary>
              <div className="mt-3">
                <FlatForm
                  date={view.date}
                  title={view.flatTitle}
                  priceCents={view.flatPriceCents}
                  hasOrders={hasOrders}
                  disabled={view.locked}
                />
              </div>
            </details>
          </GlassCard>
        )}

        <GlassCard variant="tile" className="p-5">
          <details open={view.cancelled || view.hostAbsent}>
            <summary className="flex cursor-pointer list-none items-center gap-2 font-bold">
              <Settings2 className="text-primary size-4" /> Gastgeber, Trinkgeld, Getränke, Absage
            </summary>
            <div className="mt-4 space-y-5">
              <HostPicker
                date={view.date}
                hostId={view.host?.id ?? null}
                hostIsDefault={view.hostIsDefault}
                defaultHostName={defaultHostName}
                members={members}
              />
              {!view.cancelled && (
                <ExtrasForm
                  date={view.date}
                  tipCents={view.fixedTipCents}
                  defaultTipCents={view.restaurant?.tipCents ?? DEFAULT_TIP_CENTS}
                  drinksFeeCents={view.customDrinksFeeCents}
                  defaultDrinksFeeCents={DRINKS_FEE_CENTS}
                  voucherCents={view.voucherCents}
                  showVoucher={!flat}
                  showTip={!flat && !view.pickup}
                />
              )}
              <NoteEditor date={view.date} note={view.note} />
              <CancelToggle
                date={view.date}
                cancelled={view.cancelled}
                reason={view.cancelReason}
              />
            </div>
          </details>
        </GlassCard>
      </div>

      <div className="space-y-4">
        {!view.cancelled && !flat && view.restaurant && (
          <GlassCard variant="tile" className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-bold">
                <ShoppingBag className="text-primary size-4" /> Bestellliste
              </h3>
              {hasOrders && <CopyButton text={orderSheetText(sheet)} />}
            </div>
            {sheetFor && (
              <p className="text-muted-foreground -mt-2 text-xs">
                Für {sheetFor}, das gerade bei der Wahl vorne liegt.
              </p>
            )}
            {view.voucherCents ? (
              <Notice className="flex items-center gap-2">
                <Ticket className="text-primary" />
                <span>
                  Gutschein über <strong>{formatEuro(view.voucherCents)}</strong> beim Bestellen
                  einlösen.
                </span>
              </Notice>
            ) : null}
            {hungry.length > 0 && (
              <Notice>
                <strong className="text-warning">Bekommen nichts, wenn sie nichts wählen:</strong>{' '}
                {hungry.map((entry) => entry.member.name).join(', ')}
              </Notice>
            )}
            {!hasOrders ? (
              <p className="text-muted-foreground text-sm">Noch nichts bestellt.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {sheet.map((line, index) => (
                  <li key={line.key} className="flex flex-wrap gap-2">
                    {sheet.some((other) => other.category) &&
                      (index === 0 || line.category !== sheet[index - 1]!.category) && (
                        <span className="text-primary w-full pt-1 text-[11px] font-bold tracking-[0.14em] uppercase">
                          {line.category ?? 'Sonstiges'}
                        </span>
                      )}
                    <span className="text-primary w-7 shrink-0 font-extrabold tabular-nums">
                      {line.count}×
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{line.name}</span>
                      {(line.options.length > 0 || line.notes.length > 0) && (
                        <span className="text-muted-foreground block text-xs">
                          {[...line.options, ...line.notes.map((note) => `„${note}“`)].join(' · ')}
                        </span>
                      )}
                      <span className="text-muted-foreground block text-xs">
                        {line.people.join(', ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {closed && hasOrders && (
              <div className="border-border/60 border-t pt-4">
                <h3 className="mb-3 flex items-center gap-2 font-bold">
                  <Receipt className="text-primary size-4" /> Abrechnen
                </h3>
                <SettleForm
                  date={view.date}
                  initial={centsToInput(view.finalTotalCents)}
                  settled={view.settled}
                />
              </div>
            )}
            {!view.host?.paypalMe && (
              <p className="text-warning text-xs font-semibold">
                {viewerIsHost
                  ? 'Trag in deinem Profil deinen PayPal.me-Namen ein, sonst gibt es keine Zahlungslinks.'
                  : `${view.host?.name ?? 'Der Gastgeber'} hat keinen PayPal.me-Namen im Profil, also gibt es keine Zahlungslinks.`}
              </p>
            )}
          </GlassCard>
        )}
        <UpcomingMessages messages={messages} serverNow={serverNow} whatsappDown={whatsappDown} />
      </div>
    </div>
  );
}
