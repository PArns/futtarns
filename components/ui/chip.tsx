import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A small selectable button: categories, quick amounts, roles. */
export function Chip({
  selected = false,
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { selected?: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold tabular-nums transition-colors disabled:opacity-40 max-sm:h-9',
        selected
          ? 'border-primary/60 bg-primary/15 text-foreground'
          : 'border-border text-muted-foreground hover:text-foreground',
        className
      )}
      {...props}
    />
  );
}
