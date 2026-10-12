'use client';

import { Save } from 'lucide-react';
import { useState } from 'react';
import { updateMemberAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAction } from '@/lib/hooks/use-action';

/** Admins fix a name or the phone number someone logs in with. */
export function EditMemberForm({
  id,
  name,
  phone,
}: {
  id: number;
  name: string;
  phone: string | null;
}) {
  const [value, setValue] = useState(name);
  const [number, setNumber] = useState(phone ?? '');
  const { pending, execute } = useAction();
  return (
    <form
      className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        execute(() => updateMemberAction(id, value, number));
      }}
    >
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label="Name"
        maxLength={60}
      />
      <Input
        value={number}
        onChange={(event) => setNumber(event.target.value)}
        aria-label="Handynummer"
        inputMode="tel"
        placeholder="Handynummer"
      />
      <Button type="submit" variant="outline" size="sm" className="max-sm:h-11" disabled={pending}>
        <Save /> Speichern
      </Button>
    </form>
  );
}
