'use client';

import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { issueLoginLinkAction, setRolesAction } from '@/app/actions';
import { LoginLink } from '@/components/people/login-link';
import { Button } from '@/components/ui/button';
import { useAction } from '@/lib/hooks/use-action';
import { cn } from '@/lib/utils';

export function MemberActions({
  member,
  isAdminViewer,
  canIssueLink,
}: {
  member: {
    id: number;
    name: string;
    phone: string | null;
    isAdmin: boolean;
    isDefaultHost: boolean;
    active: boolean;
    kind: string;
  };
  isAdminViewer: boolean;
  canIssueLink: boolean;
}) {
  const [link, setLink] = useState<string | null>(null);
  const { pending, execute } = useAction();

  const toggle = (label: string, active: boolean, roles: Parameters<typeof setRolesAction>[1]) => (
    <button
      type="button"
      disabled={pending}
      onClick={() => execute(() => setRolesAction(member.id, roles))}
      className={cn(
        'h-7 rounded-full border px-2.5 text-xs font-semibold transition-colors max-sm:h-9',
        active
          ? 'border-primary/50 bg-primary/15 text-foreground'
          : 'border-border text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className={cn('flex flex-wrap items-center gap-1.5', pending && 'opacity-60')}>
        {canIssueLink && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              const question =
                member.kind === 'guest'
                  ? `${member.name} zum Mitglied machen und einen Login-Link erzeugen?`
                  : `Neuen Link für ${member.name} erzeugen? Der alte funktioniert dann nicht mehr.`;
              if (window.confirm(question)) {
                execute(
                  () => issueLoginLinkAction(member.id),
                  (result) => result.ok && setLink(result.link ?? null)
                );
              }
            }}
          >
            <KeyRound /> {member.kind === 'guest' ? 'Zum Mitglied machen' : 'Neuer Link'}
          </Button>
        )}
        {isAdminViewer && member.kind === 'member' && (
          <>
            {toggle('Admin', member.isAdmin, { isAdmin: !member.isAdmin })}
            {toggle('Standard-Gastgeber', member.isDefaultHost, {
              isDefaultHost: !member.isDefaultHost,
            })}
            {toggle(member.active ? 'Aktiv' : 'Inaktiv', member.active, { active: !member.active })}
          </>
        )}
      </div>
      {link && <LoginLink name={member.name} link={link} phone={member.phone} />}
    </div>
  );
}
