'use client';

import { RefreshCw, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { relinkWhatsAppAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/input';
import { useAction } from '@/lib/hooks/use-action';

/** Unlinks the bot's current WhatsApp so another phone number can send from now on. */
export function RelinkWhatsApp({ linked }: { linked: boolean }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const { pending, execute } = useAction();
  const router = useRouter();

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Smartphone /> {linked ? 'Andere Nummer verknüpfen' : 'Neu starten'}
      </Button>
    );
  }

  return (
    <form
      className="border-border/60 space-y-3 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          linked &&
          !window.confirm(
            'Den Bot von der jetzigen Nummer abmelden? Bis die neue verknüpft ist, gehen keine Nachrichten raus.'
          )
        ) {
          return;
        }
        execute(
          () => relinkWhatsAppAction(phone),
          () => {
            setOpen(false);
            // The bot needs a moment for the new QR or pairing code.
            setTimeout(() => router.refresh(), 4_000);
          }
        );
      }}
    >
      <Label>
        Nummer des neuen Bot-Handys (optional)
        <Input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          inputMode="tel"
          placeholder="0170 1234567"
        />
        <Hint>Mit Nummer gibt es einen Code zum Eintippen, ohne einen QR-Code zum Scannen.</Hint>
      </Label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          <RefreshCw /> {linked ? 'Abmelden und neu verknüpfen' : 'Neu starten'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
