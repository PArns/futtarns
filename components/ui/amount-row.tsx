import { formatEuro } from '@/lib/format';
import { cn } from '@/lib/utils';

/** One line of a bill: label left, euro amount right. Use inside a `<dl>`. */
export function AmountRow({
  label,
  cents,
  emphasis = 'normal',
  className,
}: {
  label: React.ReactNode;
  cents: number;
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
      <dt className={cn(emphasis === 'normal' && 'text-muted-foreground')}>{label}</dt>
      <dd className="shrink-0 tabular-nums">{formatEuro(cents)}</dd>
    </div>
  );
}
