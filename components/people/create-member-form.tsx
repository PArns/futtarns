'use client';

import { UserPlus } from 'lucide-react';
import { useActionState } from 'react';
import { createMemberAction } from '@/app/actions';
import { LoginLink } from '@/components/people/login-link';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import type { ActionResult } from '@/lib/action-result';

export function CreateMemberForm({ canGrantAdmin }: { canGrantAdmin: boolean }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createMemberAction,
    null
  );
  return (
    <div className="space-y-4">
      <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Label>
          Name
          <Input name="name" required maxLength={60} placeholder="Vorname" />
        </Label>
        <Label>
          Handynummer
          <Input name="phone" inputMode="tel" placeholder="+49 170 1234567" />
        </Label>
        <Button type="submit" disabled={pending}>
          <UserPlus /> Anlegen
        </Button>
        {canGrantAdmin && (
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" name="isAdmin" className="accent-primary size-4" /> Admin
          </label>
        )}
      </form>
      {state && !state.ok && <p className="text-error text-sm">{state.error}</p>}
      {state?.ok && state.link && (
        <LoginLink
          name={state.message?.replace(/ ist angelegt$/, '') ?? ''}
          link={state.link}
          phone={null}
        />
      )}
    </div>
  );
}
