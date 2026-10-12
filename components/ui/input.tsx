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

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(field, 'dark:[&>option]:bg-popover h-9 py-1 max-sm:h-11', className)}
      {...props}
    />
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
