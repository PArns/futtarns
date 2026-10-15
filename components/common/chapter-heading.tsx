import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A section head: a faint number or icon, a kicker, the title and an optional hint. With a
 * number, the icon moves next to the kicker. On phones the big number or icon would push
 * the title away from the cards below, so the number joins the kicker there and the icon
 * goes.
 */
export function ChapterHeading({
  number,
  icon: Icon,
  kicker,
  title,
  hint,
  action,
  className,
  id,
  compact = false,
}: {
  number?: number;
  icon?: LucideIcon;
  kicker?: string;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
  id?: string;
  /** For a narrow column: the phone layout at every width, the action below the text. */
  compact?: boolean;
}) {
  const shown = number !== undefined ? String(number).padStart(2, '0') : null;
  return (
    <div
      id={id}
      className={cn(
        'border-border mb-6 flex items-start gap-3 border-b pb-4 sm:gap-4',
        compact && 'flex-wrap',
        className
      )}
    >
      {!compact &&
        (shown ? (
          <span className="text-primary/25 shrink-0 text-6xl leading-none font-black tabular-nums max-sm:hidden">
            {shown}
          </span>
        ) : Icon ? (
          <Icon className="text-primary/25 size-12 shrink-0 max-sm:hidden" />
        ) : null)}
      <div className="min-w-0 flex-1">
        {(kicker || shown) && (
          <div className="text-primary mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase">
            {shown && (
              <span className={cn('tabular-nums', !compact && 'sm:hidden')}>{shown} ·</span>
            )}
            {Icon && (
              <Icon className={cn('size-3.5 shrink-0', !shown && !compact && 'sm:hidden')} />
            )}
            {kicker}
          </div>
        )}
        <h2 className={cn('text-xl font-bold', !compact && 'sm:text-3xl')}>{title}</h2>
        {hint && <p className="text-muted-foreground mt-1.5 max-w-prose text-sm">{hint}</p>}
      </div>
      {action && <div className={cn('shrink-0', compact ? 'w-full' : 'self-center')}>{action}</div>}
    </div>
  );
}
