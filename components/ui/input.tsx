import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const field =
  'w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(field, 'h-9 py-1 max-sm:h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'min-h-24 py-2', className)} {...props} />;
}

const SELECT_SIZES = {
  default: 'h-9 max-sm:h-11',
  // The pill on cards and in the calendar.
  sm: 'h-7 rounded-full px-2.5 text-xs font-semibold md:text-xs max-sm:h-9',
};

/**
 * A native select with its own chevron: the browser's arrow sat on the rounded border.
 * `className` styles the select, `containerClassName` places it in its row.
 */
export function Select({
  className,
  containerClassName,
  variant = 'default',
  ...props
}: ComponentProps<'select'> & {
  containerClassName?: string;
  variant?: keyof typeof SELECT_SIZES;
}) {
  return (
    <span className={cn('relative block', containerClassName)}>
      <select
        className={cn(
          field,
          'dark:[&>option]:bg-popover appearance-none py-0 pr-8',
          SELECT_SIZES[variant],
          className
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2"
      />
    </span>
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label className={cn('flex flex-col gap-1.5 text-sm font-medium', className)} {...props} />
  );
}

export function Hint({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-muted-foreground text-xs font-normal', className)} {...props} />;
}
