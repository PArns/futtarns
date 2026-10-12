import type { ReactNode } from 'react';
import { BrandMark } from '@/components/layout/brand';

/** The login screens' frame: sky, a glass card and the brand on top. */
export function LoginShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <div aria-hidden className="sky-gradient dark:brand-gradient absolute inset-0 -z-10" />
      <div
        aria-hidden
        className="to-background/80 absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-b from-transparent"
      />
      <div className="glass-heavy w-full max-w-md rounded-3xl border p-6 shadow-xl sm:p-8">
        <div className="hero-item flex items-center gap-3">
          <BrandMark className="h-12" />
          <div>
            <div className="text-2xl leading-none font-extrabold tracking-tight">
              freitach<span className="text-primary">.</span>
            </div>
            <div className="text-muted-foreground mt-1 text-sm">Freitags zusammen essen</div>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
