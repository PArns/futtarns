'use client';

import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { addGuestAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint, Input } from '@/components/ui/input';
import { useAction } from '@/lib/hooks/use-action';

/**
 * Brings a guest to a Friday. With a phone number they get an invitation by WhatsApp and
 * can log in, order, pay and vote themselves, for the Fridays someone invites them to.
 */
export function AddGuestForm({ date }: { date: string }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const { pending, execute } = useAction();
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        execute(
          () => addGuestAction(date, name, phone),
          () => {
            setName('');
            setPhone('');
          }
        );
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name des Gasts"
          maxLength={60}
          aria-label="Name des Gasts"
        />
        <Input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="Handynummer (optional)"
          inputMode="tel"
          maxLength={30}
          aria-label="Handynummer des Gasts"
        />
        <Button type="submit" variant="outline" disabled={pending || !name.trim()}>
          <UserPlus /> Gast
        </Button>
      </div>
      <Hint>
        Mit Nummer bekommt dein Gast eine Einladung per WhatsApp, sucht sich selbst was aus, zahlt
        selbst und stimmt mit ab. Ab dem nächsten Freitag ist er wieder raus, bis ihn jemand
        einlädt.
      </Hint>
    </form>
  );
}
