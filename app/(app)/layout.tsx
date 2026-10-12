import type { ReactNode } from 'react';
import { Header } from '@/components/layout/header';
import { Toaster } from '@/components/ui/toaster';
import { getGroupContext } from '@/lib/session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { canManage } = await getGroupContext();
  return (
    <Toaster>
      <div className="flex min-h-dvh flex-col">
        <Header canManage={canManage} />
        <main className="flex-1 pb-16">{children}</main>
      </div>
    </Toaster>
  );
}
