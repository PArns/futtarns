'use client';

import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { addGuestAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAction } from '@/lib/hooks/use-action';

export function AddGuestForm({ date }: { date: string }) {
  const [name, setName] = useState('');
  const { pending, execute } = useAction();
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        execute(
          () => addGuestAction(date, name),
          () => setName('')
        );
      }}
    >
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name des Gasts"
        maxLength={60}
        aria-label="Name des Gasts"
      />
      <Button type="submit" variant="outline" disabled={pending || !name.trim()}>
        <UserPlus /> Gast
      </Button>
    </form>
  );
}
