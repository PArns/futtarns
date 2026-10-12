'use client';

import { Plane, Trash2 } from 'lucide-react';
import { useActionState } from 'react';
import { addAbsenceAction, removeAbsenceAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import type { ActionResult } from '@/lib/action-result';
import { useAction } from '@/lib/hooks/use-action';

export function AbsenceForm({ defaultFrom }: { defaultFrom: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    addAbsenceAction,
    null
  );
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
      <Label>
        Von
        <Input type="date" name="fromDate" defaultValue={defaultFrom} required />
      </Label>
      <Label>
        Bis
        <Input type="date" name="toDate" defaultValue={defaultFrom} required />
      </Label>
      <Label>
        Notiz
        <Input name="note" placeholder="z. B. Urlaub" maxLength={100} />
      </Label>
      <Button type="submit" disabled={pending}>
        <Plane /> Eintragen
      </Button>
      {state && !state.ok && <p className="text-error text-sm sm:col-span-4">{state.error}</p>}
    </form>
  );
}

export function RemoveAbsenceButton({ id }: { id: number }) {
  const { pending, execute } = useAction();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Löschen"
      disabled={pending}
      onClick={() => execute(() => removeAbsenceAction(id))}
    >
      <Trash2 />
    </Button>
  );
}
