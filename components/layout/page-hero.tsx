import type { ReactNode } from 'react';
import { Pill } from '@/components/ui/pill';
import { cn } from '@/lib/utils';

/**
 * The top of every page: the brand gradient running under the header, and a heavy glass
 * plate on it. Only the plate's children animate in; the plate itself must stay still.
 */
export function PageHero({
  kicker,
  aside,
  title,
  children,
  className,
}: {
  kicker?: ReactNode;
  /** Small controls at the top right, next to the kicker. */
  aside?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('relative -mt-12 px-4 pt-20 pb-8 sm:pt-24 sm:pb-10', className)}>
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
        <div className="sky-gradient dark:brand-gradient absolute inset-0" />
        <div className="to-background absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-b from-transparent" />
      </div>
      <div className="glass-heavy mx-auto w-full max-w-5xl min-w-0 rounded-3xl border p-6 shadow-xl sm:p-8">
        {(kicker || aside) && (
          <div className="hero-item mb-3 flex items-center justify-between gap-2">
            {kicker && (
              <Pill size="label" className="min-w-0 shadow-none">
                {kicker}
              </Pill>
            )}
            {aside && <div className="-my-2 -mr-2 flex shrink-0 items-center">{aside}</div>}
          </div>
        )}
        <h1 className="hero-item text-3xl font-extrabold tracking-tight text-balance sm:text-5xl">
          {title}
        </h1>
        {children}
      </div>
    </section>
  );
}
