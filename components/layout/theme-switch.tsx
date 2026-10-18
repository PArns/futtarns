'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useMounted } from '@/lib/hooks/use-mounted';
import { cn } from '@/lib/utils';

export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  // The theme is only known in the browser; before that the knob sits on dark, the default.
  const dark = !mounted || resolvedTheme !== 'light';
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Helles Design' : 'Dunkles Design'}
      className="border-border/60 bg-muted/60 hover:border-primary/50 relative inline-flex h-7 w-12 shrink-0 rounded-full border transition-colors max-[400px]:w-10"
    >
      <span
        className={cn(
          'bg-background absolute top-1/2 flex size-5.5 -translate-y-1/2 items-center justify-center rounded-full shadow-sm transition-[left] duration-300',
          dark ? 'left-[0.125rem]' : 'left-[calc(100%-1.5rem)]'
        )}
      >
        {dark ? <Moon className="size-3" /> : <Sun className="size-3" />}
      </span>
    </button>
  );
}
