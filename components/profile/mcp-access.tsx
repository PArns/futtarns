'use client';

import { KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { createMcpTokenAction, revokeMcpTokenAction } from '@/app/actions';
import { CopyButton } from '@/components/common/copy-button';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/input';
import { useAction } from '@/lib/hooks/use-action';

export type McpKey = { id: number; name: string; created: string; lastUsed: string | null };

/** One line to copy into a terminal: Claude Code then knows freitach as an MCP server. */
function claudeCodeCommand(endpoint: string, token: string): string {
  return `claude mcp add --transport http freitach ${endpoint} --header "Authorization: Bearer ${token}"`;
}

/**
 * The viewer's MCP keys: make one (shown once, with what to paste where), see when each was
 * last used, and delete them.
 */
export function McpAccess({ endpoint, keys }: { endpoint: string; keys: McpKey[] }) {
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const { pending, execute } = useAction();

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <div className="text-muted-foreground text-xs">Adresse des MCP-Servers</div>
        <div className="flex flex-wrap items-center gap-3">
          <code className="bg-muted/60 min-w-0 flex-1 truncate rounded-md px-3 py-2 text-xs">
            {endpoint}
          </code>
          <CopyButton text={endpoint} />
        </div>
      </div>

      {fresh && (
        <div className="border-primary/40 bg-primary/5 space-y-3 rounded-lg border p-4">
          <div className="text-sm font-semibold">Dein neuer Schlüssel – nur jetzt sichtbar</div>
          <div className="flex flex-wrap items-center gap-3">
            <code className="bg-muted/60 min-w-0 flex-1 rounded-md px-3 py-2 text-xs break-all">
              {fresh}
            </code>
            <CopyButton text={fresh} />
          </div>
          <div className="text-muted-foreground text-xs">Für Claude Code im Terminal:</div>
          <div className="flex flex-wrap items-center gap-3">
            <code className="bg-muted/60 min-w-0 flex-1 rounded-md px-3 py-2 text-xs break-all">
              {claudeCodeCommand(endpoint, fresh)}
            </code>
            <CopyButton text={claudeCodeCommand(endpoint, fresh)} />
          </div>
          <Hint>
            Andere MCP-Clients brauchen die Adresse oben und den Header{' '}
            <code>Authorization: Bearer …</code> mit dem Schlüssel.
          </Hint>
        </div>
      )}

      {keys.length > 0 && (
        <ul className="divide-border/50 divide-y">
          {keys.map((key) => (
            <li key={key.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{key.name}</div>
                <div className="text-muted-foreground text-xs">
                  erstellt {key.created} ·{' '}
                  {key.lastUsed ? `zuletzt benutzt ${key.lastUsed}` : 'noch nie benutzt'}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Schlüssel „${key.name}“ löschen`}
                disabled={pending}
                onClick={() => {
                  if (
                    window.confirm(
                      `„${key.name}“ löschen? Was ihn benutzt, kommt dann nicht mehr rein.`
                    )
                  ) {
                    execute(() => revokeMcpTokenAction(key.id));
                  }
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          execute(
            () => createMcpTokenAction(name),
            (result) => {
              if (result.ok && result.secret) setFresh(result.secret);
              setName('');
            }
          );
        }}
      >
        <Label>
          Neuer Schlüssel
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            placeholder="z. B. Claude Code am Laptop"
          />
          <Hint>
            Wer den Schlüssel hat, kann freitach mit deinen Rechten lesen und ändern. Gib ihn nur
            deinem eigenen Claude und lösch ihn, wenn du ihn nicht mehr brauchst.
          </Hint>
        </Label>
        <Button type="submit" disabled={pending || name.trim().length === 0}>
          <KeyRound /> Schlüssel erstellen
        </Button>
      </form>
    </div>
  );
}
