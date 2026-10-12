import { cn } from '@/lib/utils';

/** The visual part of an on/off switch; the clickable element around it carries the role. */
export function SwitchKnob({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full border transition-colors',
        on ? 'border-primary bg-primary' : 'border-border bg-muted',
        className
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 size-4.5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left] duration-200',
          on ? 'left-[calc(100%-1.25rem)]' : 'left-0.5'
        )}
      />
    </span>
  );
}
