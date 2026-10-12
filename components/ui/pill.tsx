import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const pillVariants = cva(
  'inline-flex w-fit items-center gap-1.5 rounded-full border font-bold whitespace-nowrap tabular-nums [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        primary: 'border-primary/40 bg-primary/10 text-primary',
        success: 'border-success/40 bg-success/10 text-success',
        warning: 'border-warning/40 bg-warning/10 text-warning',
        error: 'border-error/40 bg-error/10 text-error',
        muted: 'border-border bg-muted/60 text-muted-foreground',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs max-sm:h-8',
        /** The uppercase label style park.fan uses for kickers and live states. */
        label: 'h-[30px] px-3.5 text-[11px] tracking-[0.14em] uppercase shadow-sm',
      },
    },
    defaultVariants: { tone: 'primary', size: 'sm' },
  }
);

/** A rounded status label: money states, the deadline, page kickers. */
export function Pill({
  tone,
  size,
  className,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof pillVariants>) {
  return <span className={cn(pillVariants({ tone, size }), className)} {...props} />;
}

/** The static dot inside a live pill; it does not pulse because it sits inside glass. */
export function PillDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn('size-1.5 rounded-full bg-current', className)} />;
}
