import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login/login-form';
import { LoginShell } from '@/components/login/login-shell';
import { Notice } from '@/components/ui/notice';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Anmelden' };

export default async function LoginPage(props: PageProps<'/login'>) {
  if (await getViewer()) redirect('/');
  const params = await props.searchParams;
  const phone = typeof params.phone === 'string' ? params.phone : '';
  const code = typeof params.code === 'string' ? params.code : '';
  const invalidLink = params.link === 'invalid';

  return (
    <LoginShell>
      {invalidLink && (
        <Notice className="hero-item text-warning mt-6 text-sm font-semibold">
          Der Link ist nicht mehr gültig. Melde dich einfach mit deiner Nummer an.
        </Notice>
      )}
      <div className="hero-item mt-6">
        <LoginForm initialPhone={phone} initialCode={code} />
      </div>
    </LoginShell>
  );
}
