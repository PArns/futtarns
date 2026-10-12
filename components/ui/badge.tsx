import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        outline: 'text-foreground',
        primary:
          'border-primary/25 bg-badge-primary/60 font-bold tracking-wide text-white uppercase',
        success:
          'border-success/25 bg-badge-success/(--badge-fill) font-bold tracking-wide text-white uppercase shadow-md',
        warning:
          'border-warning/25 bg-badge-warning/(--badge-fill) font-bold tracking-wide text-white uppercase shadow-md',
        error:
          'border-error/25 bg-badge-error/(--badge-fill) font-bold tracking-wide text-white uppercase shadow-md',
        muted:
          'border-border bg-badge-muted/(--badge-fill) font-bold tracking-wide text-white uppercase',
        soft: 'border-primary/30 bg-primary/10 text-primary',
        softSuccess: 'border-success/30 bg-success/10 text-success',
        softWarning: 'border-warning/30 bg-warning/10 text-warning',
        softError: 'border-error/30 bg-error/10 text-error',
      },
    },
    defaultVariants: { variant: 'outline' },
  }
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
