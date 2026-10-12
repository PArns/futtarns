import { cn } from '@/lib/utils';

export function DutchFlag({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 9 6"
      aria-hidden
      className={cn('ring-foreground/15 h-3 w-[18px] shrink-0 rounded-[2px] ring-1', className)}
    >
      <rect width="9" height="2" fill="#ae1c28" />
      <rect y="2" width="9" height="2" fill="#fff" />
      <rect y="4" width="9" height="2" fill="#21468b" />
    </svg>
  );
}
