import { CircleCheck, House, Undo2 } from 'lucide-react';
import { DrinksToggle } from '@/components/friday/drinks-toggle';
import { PayBox } from '@/components/friday/pay-box';
import { formatEuro } from '@/lib/format';
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
}: {
  view: FridayView;
  me: Participant;
  canEdit: boolean;
}) {
  const host = view.host;
  if (!host) return null;
  if (host.id === me.member.id) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <House className="text-primary size-4 shrink-0" />
        Du bist Gastgeber und zahlst nichts – das Geld kommt zu dir.
      </p>
    );
  }
  const comes = me.attendance.status !== 'out' && !view.cancelled;
  const billed = view.mode === 'flat' || view.settled;
  const open = me.money.openCents;

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
      {open >= NAG_THRESHOLD_CENTS || (open > 0 && billed) ? (
        <PayBox
          date={view.date}
          memberId={me.member.id}
          money={me.money}
          payeeName={host.name}
          paypalMe={host.paypalMe}
        />
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
