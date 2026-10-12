'use client';

import { ClipboardPaste, FileText } from 'lucide-react';
import { useDeferredValue, useEffect, useState, useSyncExternalStore } from 'react';
import { bulkAddDishesAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint, Textarea } from '@/components/ui/input';
import { formatEuro } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { parseBulkDishes } from '@/lib/menu/bulk';
import { cn } from '@/lib/utils';

/** The text the Lieferando bookmarklet hands over in the URL fragment. */
export const IMPORT_HASH = '#import=';

function subscribeToHash(notify: () => void) {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
}

/** The menu text the bookmarklet put into the address, or an empty string. */
function useIncomingMenu(): string {
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => ''
  );
  return hash.startsWith(IMPORT_HASH) ? decodeURIComponent(hash.slice(IMPORT_HASH.length)) : '';
}

/**
 * Takes a whole menu as text — pasted, or brought over by the bookmarklet — and shows what
 * was understood. Every dish can be unticked before anything is saved.
 */
export function MenuImport({ restaurantId }: { restaurantId: number }) {
  const incoming = useIncomingMenu();
  // null until the user types: until then the text is whatever the bookmarklet brought.
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? incoming;
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const deferred = useDeferredValue(text);
  const preview = parseBulkDishes(deferred);
  const { pending, execute } = useAction();

  useEffect(() => {
    if (incoming)
      document.getElementById('karte-einfuegen')?.scrollIntoView({ behavior: 'smooth' });
  }, [incoming]);

  const chosen = preview.dishes.filter((_, index) => !skipped.has(index));

  return (
    <div className="space-y-3">
      <Textarea
        value={text}
        onChange={(event) => {
          setTyped(event.target.value);
          setSkipped(new Set());
        }}
        className="min-h-40 font-mono text-xs"
        placeholder={
          '# Pizza\nMargherita 8,50 | Tomate, Mozzarella\nSalami 9,50\n\noder direkt von Lieferando kopiert:\nPizza Funghi\nmit Champignons\n9,90 €'
        }
      />
      {deferred.trim() && (
        <div className="bg-muted/30 max-h-80 overflow-y-auto rounded-xl border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
            <FileText className="text-primary size-3.5" /> {chosen.length} von{' '}
            {preview.dishes.length} Gerichten übernehmen
            {preview.errors.length > 0 && (
              <span className="text-muted-foreground font-normal">
                · {preview.errors.length} Zeilen ohne Preis übersprungen
              </span>
            )}
          </div>
          <ul className="divide-border/50 divide-y text-sm">
            {preview.dishes.map((dish, index) => {
              const on = !skipped.has(index);
              return (
                <li key={index}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-baseline gap-2 py-1.5',
                      !on && 'opacity-40'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSkipped((current) => {
                          const next = new Set(current);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          return next;
                        })
                      }
                      className="accent-primary size-4 shrink-0 self-center"
                    />
                    {dish.category && (
                      <span className="text-primary shrink-0 text-[10px] font-bold tracking-wider uppercase">
                        {dish.category}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{dish.name}</span>
                    <span className="shrink-0 tabular-nums">{formatEuro(dish.priceCents)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={pending || chosen.length === 0}
          onClick={() =>
            execute(
              () => bulkAddDishesAction(restaurantId, chosen),
              () => {
                // Drop the menu from the address too, so a reload does not offer it again.
                history.replaceState(null, '', window.location.pathname);
                setTyped('');
                setSkipped(new Set());
              }
            )
          }
        >
          <ClipboardPaste />{' '}
          {chosen.length > 0 ? `${chosen.length} Gerichte übernehmen` : 'Übernehmen'}
        </Button>
        <Hint>
          Schon vorhandene Gerichte (gleicher Name) bekommen den neuen Preis statt eines Duplikats.
        </Hint>
      </div>
    </div>
  );
}
