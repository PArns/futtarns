import { CircleCheck, Undo2 } from 'lucide-react';
import { DrinksToggle } from '@/components/friday/drinks-toggle';
import { PayBox } from '@/components/friday/pay-box';
import { shareLines } from '@/lib/balance';
import { formatEuro, formatTime } from '@/lib/format';
import { NAG_THRESHOLD_CENTS } from '@/lib/reminders';
import type { FridayView, Participant } from '@/lib/services/fridays';

/**
 * The viewer's money for one Friday: the drinks switch and then whatever applies — pay
 * now, all paid, money back, or a few cents that the settlement will sort out.
 */
export function MyMoney({
  view,
  me,
  canEdit,
  payable,
}: {
  view: FridayView;
  me: Participant;
  canEdit: boolean;
  /** Whether paying is open yet; it opens at the deadline. */
  payable: boolean;
}) {
  const host = view.host;
  if (!host) return null;
  // The host sees the same box with their own share, minus the pay buttons.
  if (host.id === me.member.id) {
    if (!me.share) return null;
    return (
      <PayBox
        date={view.date}
        memberId={me.member.id}
        amountCents={me.share.totalCents}
        lines={shareLines(view, me)}
        payeeName={null}
        paypalMe={null}
        label="Dein Anteil"
        payable={false}
        note="Du bist Gastgeber: Lieferando zahlst du direkt, das Geld der anderen kommt zu dir."
      />
    );
  }
  const comes = me.attendance.status !== 'out' && !view.cancelled;
  const billed = view.mode === 'flat' || view.settled;
  const open = me.money.openCents;
  const box = (props: { label?: string; payable: boolean; note?: string }) => (
    <PayBox
      date={view.date}
      memberId={me.member.id}
      amountCents={open}
      lines={shareLines(view, me)}
      payeeName={host.name}
      paypalMe={host.paypalMe}
      {...props}
    />
  );

  return (
    <div className="space-y-3">
      {comes && view.drinksFeeCents > 0 && (
        <DrinksToggle
          date={view.date}
          memberId={me.member.id}
          feeCents={view.drinksFeeCents}
          on={!me.drinksOptOut}
          disabled={!canEdit}
        />
      )}
      {open > 0 && !payable ? (
        box({
          label: 'Bis jetzt',
          payable: false,
          note: `Bezahlt wird nach dem Bestellschluss um ${formatTime(view.deadline)}, dann steht fest, was alle bestellt haben. Den Link bekommst du per WhatsApp.`,
        })
      ) : open >= NAG_THRESHOLD_CENTS || (open > 0 && billed) ? (
        box({ payable: true })
      ) : open > 0 ? (
        <p className="text-muted-foreground text-sm">
          Noch {formatEuro(open)} offen, weil sich die Gebühren verteilt haben. Das gleichen wir
          nach der Bestellung aus.
        </p>
      ) : open < 0 ? (
        <p className="border-primary/40 bg-primary/10 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm">
          <Undo2 className="text-primary size-4 shrink-0" />
          Du hast {formatEuro(-open)} zu viel gezahlt. {host.name} gibt dir das zurück.
        </p>
      ) : me.money.dueCents > 0 ? (
        <p className="text-success flex items-center gap-2 text-sm font-semibold">
          <CircleCheck className="size-4 shrink-0" /> Alles bezahlt (
          {formatEuro(me.money.paidCents)}) – danke!
        </p>
      ) : null}
    </div>
  );
}
