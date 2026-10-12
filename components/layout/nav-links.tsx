'use client';

import { CalendarDays, CircleUser, Store, Users, UtensilsCrossed } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  {
    href: '/',
    label: 'Freitag',
    icon: UtensilsCrossed,
    match: (p: string) => p === '/' || p.startsWith('/freitag'),
  },
  {
    href: '/kalender',
    label: 'Kalender',
    icon: CalendarDays,
    match: (p: string) => p.startsWith('/kalender'),
  },
  {
    href: '/restaurants',
    label: 'Restaurants',
    icon: Store,
    match: (p: string) => p.startsWith('/restaurants'),
  },
  {
    href: '/leute',
    label: 'Leute',
    icon: Users,
    match: (p: string) => p.startsWith('/leute'),
    managersOnly: true,
  },
  { href: '/ich', label: 'Ich', icon: CircleUser, match: (p: string) => p.startsWith('/ich') },
];

export function NavLinks({ canManage }: { canManage: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 sm:gap-1.5">
      {LINKS.filter((link) => !link.managersOnly || canManage).map(
        ({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors duration-200 sm:px-2.5',
                active
                  ? 'bg-primary/12 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="text-primary size-4 shrink-0 sm:size-3.5" />
              <span className="max-md:sr-only">{label}</span>
            </Link>
          );
        }
      )}
    </nav>
  );
}
