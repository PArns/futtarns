import { LogIn } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signInWithLinkAction } from '@/app/actions';
import { LoginShell } from '@/components/login/login-shell';
import { Button } from '@/components/ui/button';
import { getDb } from '@/lib/db';
import { findMemberByLoginToken } from '@/lib/services/members';

export const metadata: Metadata = { title: 'Anmelden' };

/**
 * A personal login link. Opening it only shows who it is for; the button uses it up. Link
 * previews in chat apps open links too, and must not spend it.
 */
export default async function LoginLinkPage(props: PageProps<'/login/[token]'>) {
  const { token } = await props.params;
  const member = await findMemberByLoginToken(await getDb(), token);
  if (!member) redirect('/login?link=invalid');

  return (
    <LoginShell>
      <div className="hero-item mt-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold">Hi {member.name}!</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Mit diesem Link meldest du dich auf diesem Gerät an. Er funktioniert nur einmal, danach
            geht es mit deiner Handynummer weiter.
          </p>
        </div>
        <form action={signInWithLinkAction.bind(null, token)}>
          <Button type="submit" size="lg" className="w-full">
            <LogIn /> Anmelden
          </Button>
        </form>
      </div>
    </LoginShell>
  );
}
