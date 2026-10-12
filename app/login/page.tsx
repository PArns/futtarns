import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login/login-form';
import { BrandMark } from '@/components/layout/brand';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Anmelden' };

export default async function LoginPage(props: PageProps<'/login'>) {
  if (await getViewer()) redirect('/');
  const params = await props.searchParams;
  const phone = typeof params.phone === 'string' ? params.phone : '';
  const code = typeof params.code === 'string' ? params.code : '';
  const invalidLink = params.link === 'invalid';

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
        {invalidLink && (
          <p className="hero-item border-warning/40 bg-warning/10 text-warning mt-6 rounded-xl border p-3 text-sm font-semibold">
            Der Link ist nicht mehr gültig. Melde dich einfach mit deiner Nummer an.
          </p>
        )}
        <div className="hero-item mt-6">
          <LoginForm initialPhone={phone} initialCode={code} />
        </div>
      </div>
    </main>
  );
}
