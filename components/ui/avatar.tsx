import { cn } from '@/lib/utils';

const HUES = [241, 192, 145, 28, 300, 60, 210, 340];

/** Initials on a colour picked from the member id, so everyone keeps their colour. */
export function Avatar({ name, id, className }: { name: string; id: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
  const hue = HUES[id % HUES.length];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm',
        className
      )}
      style={{
        background: `linear-gradient(150deg, oklch(0.68 0.14 ${hue}), oklch(0.5 0.15 ${hue}))`,
      }}
    >
      {initials || '?'}
    </span>
  );
}
