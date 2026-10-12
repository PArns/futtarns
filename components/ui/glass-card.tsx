import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const variants = {
  medium: 'bg-background/60 backdrop-blur-md',
  strong: 'bg-background/80 backdrop-blur-lg',
  heavy: 'bg-background/62 backdrop-blur-xl dark:bg-[oklch(0.13_0.02_241_/_0.6)]',
  tile: 'bg-background/75 backdrop-blur-2xl dark:bg-[oklch(0.13_0.02_241_/_0.75)]',
  flat: 'bg-muted/30',
};

export function GlassCard({
  className,
  variant = 'medium',
  ...props
}: ComponentProps<'div'> & { variant?: keyof typeof variants }) {
  return (
    <div
      className={cn('rounded-xl border p-6 shadow-sm', variants[variant], className)}
      {...props}
    />
  );
}
