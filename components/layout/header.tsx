import Link from 'next/link';
import { BrandLockup } from '@/components/layout/brand';
import { NavLinks } from '@/components/layout/nav-links';
import { ThemeSwitch } from '@/components/layout/theme-switch';
import { HollandChip } from '@/components/pentecost/holland-countdown';

export function Header({ canManage, serverNow }: { canManage: boolean; serverNow: number }) {
  return (
    <header className="border-border/50 sticky top-0 z-50 h-12 border-b">
      {/* The glass is a sibling layer: backdrop-filter on <header> itself would make it the
          backdrop root for everything inside. */}
      <div
        aria-hidden
        className="bg-background/80 pointer-events-none absolute inset-0 -z-10 backdrop-blur-md"
      />
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between gap-2 px-4">
        <Link href="/" className="flex shrink-0 items-center" aria-label="freitach – Startseite">
          <BrandLockup className="max-[400px]:[&>span]:hidden" />
        </Link>
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <HollandChip serverNow={serverNow} />
          <NavLinks canManage={canManage} />
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}
