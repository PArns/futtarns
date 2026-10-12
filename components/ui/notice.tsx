import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A boxed note in the warning colour, for something someone still has to sort out. */
export function Notice({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'border-warning/40 bg-warning/10 rounded-xl border p-3 text-xs [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  );
}
