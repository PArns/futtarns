import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A section head: a faint number or icon, a kicker, the title and an optional hint. With a
 * number, the icon moves next to the kicker.
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
}: {
  number?: number;
  icon?: LucideIcon;
  kicker?: string;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn('border-border mb-6 flex items-start gap-3 border-b pb-4 sm:gap-4', className)}
    >
      {number !== undefined ? (
        <span className="text-primary/15 shrink-0 text-3xl leading-none font-black tabular-nums sm:text-6xl">
          {String(number).padStart(2, '0')}
        </span>
      ) : Icon ? (
        <Icon className="text-primary/25 size-8 shrink-0 sm:size-12" />
      ) : null}
      <div className="min-w-0 flex-1">
        {kicker && (
          <div className="text-primary mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase">
            {number !== undefined && Icon && <Icon className="size-3.5 shrink-0" />}
            {kicker}
          </div>
        )}
        <h2 className="text-xl font-bold sm:text-3xl">{title}</h2>
        {hint && <p className="text-muted-foreground mt-1.5 text-sm">{hint}</p>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
