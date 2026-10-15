import { Crown, Vote } from 'lucide-react';
import { ItemRow } from '@/components/friday/item-row';
import type { OrderItem } from '@/lib/db/schema';
import { cn } from '@/lib/utils';

export type OrderGroup = {
  restaurantId: number;
  name: string;
  /** Ordered ahead from the restaurant someone votes for: counts only if it wins. */
  ahead: boolean;
  items: OrderItem[];
};

/**
 * What someone ordered. Once they also ordered ahead during the vote, it is grouped by
 * restaurant under its name: the Friday's restaurant first, the one they vote for below.
 */
export function OrderedItems({
  groups,
  editable,
  className,
}: {
  groups: OrderGroup[];
  editable: boolean;
  className?: string;
}) {
  if (groups.length === 0) return null;
  const titled = groups.some((group) => group.ahead);
  return (
    <div className={cn('space-y-3', className)}>
      {groups.map((group) => (
        <div key={group.restaurantId}>
          {titled && (
            <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
              {group.ahead ? (
                <Vote className="text-primary size-3.5 shrink-0" />
              ) : (
                <Crown className="text-warning size-3.5 shrink-0" />
              )}
              <span className="text-foreground truncate font-semibold">{group.name}</span>
              <span className="shrink-0">
                · {group.ahead ? 'zählt, wenn es gewinnt' : 'bisher'}
              </span>
            </p>
          )}
          <ul className="divide-border/50 divide-y">
            {group.items.map((item) => (
              <ItemRow key={item.id} item={item} editable={editable} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
