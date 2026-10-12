import type { LucideIcon } from 'lucide-react';
import { formatEuro } from '@/lib/format';
import { cn } from '@/lib/utils';

/** One line of a bill: label left, euro amount right. Use inside a `<dl>`. */
export function AmountRow({
  label,
  cents,
  icon: Icon,
  emphasis = 'normal',
  className,
}: {
  label: React.ReactNode;
  cents: number;
  icon?: LucideIcon;
  emphasis?: 'normal' | 'strong' | 'muted';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex justify-between gap-3',
        emphasis === 'strong' && 'font-bold',
        emphasis === 'muted' && 'text-muted-foreground',
        className
      )}
    >
      <dt
        className={cn('flex items-center gap-2', emphasis === 'normal' && 'text-muted-foreground')}
      >
        {Icon && <Icon className="text-primary/70 size-3.5 shrink-0" />}
        {label}
      </dt>
      <dd className="shrink-0 tabular-nums">{formatEuro(cents)}</dd>
    </div>
  );
}
