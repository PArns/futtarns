'use client';

import { KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { clearAssistantKeyAction, setAssistantKeyAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/input';
import { useAction } from '@/lib/hooks/use-action';

/** Enters, replaces or deletes the Claude API key; the field never shows the stored one. */
export function AssistantKeyForm({ stored }: { stored: boolean }) {
  const [key, setKey] = useState('');
  const { pending, execute } = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        execute(
          () => setAssistantKeyAction(key),
          () => setKey('')
        );
      }}
    >
      <Label>
        {stored ? 'Neuer API-Key' : 'API-Key'}
        <Input
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
        />
        <Hint>
          Aus der Anthropic Console. Er wird beim Speichern geprüft und danach nie wieder angezeigt.
        </Hint>
      </Label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || key.trim().length === 0}>
          <KeyRound /> {stored ? 'Ersetzen' : 'Speichern'}
        </Button>
        {stored && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (window.confirm('Key löschen? Dann versteht der Bot nur noch feste Befehle.')) {
                execute(() => clearAssistantKeyAction());
              }
            }}
          >
            <Trash2 /> Löschen
          </Button>
        )}
      </div>
    </form>
  );
}
