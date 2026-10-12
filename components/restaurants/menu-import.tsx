'use client';

import { ClipboardPaste, FileText } from 'lucide-react';
import { useActionState, useDeferredValue, useState } from 'react';
import { bulkAddDishesAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Hint, Textarea } from '@/components/ui/input';
import type { ActionResult } from '@/lib/action-result';
import { formatEuro } from '@/lib/format';
import { parseBulkDishes } from '@/lib/menu/bulk';

/**
 * Pasting a whole menu: Lieferando blocks automated access, so the menu comes over by
 * copy and paste, with a preview of what was understood before anything is saved.
 */
export function MenuImport({
  restaurantId,
  lieferandoUrl,
}: {
  restaurantId: number;
  lieferandoUrl: string | null;
}) {
  const [text, setText] = useState('');
  const deferred = useDeferredValue(text);
  const preview = parseBulkDishes(deferred);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (previous, form) => {
      const result = await bulkAddDishesAction(previous, form);
      if (result.ok) setText('');
      return result;
    },
    null
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <ol className="text-muted-foreground list-inside list-decimal space-y-1 text-sm">
        <li>
          {lieferandoUrl ? (
            <a
              href={lieferandoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              Die Karte bei Lieferando öffnen
            </a>
          ) : (
            'Die Karte bei Lieferando öffnen'
          )}{' '}
          und den Teil mit den Gerichten markieren und kopieren.
        </li>
        <li>
          Hier einfügen. Die Vorschau zeigt, was erkannt wurde; Zeilen ohne Preis werden angezeigt.
        </li>
        <li>Mit „# Name“ setzt du selbst eine Kategorie, z. B. „# Pizza“.</li>
      </ol>
      <Textarea
        name="menu"
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="min-h-40 font-mono text-xs"
        placeholder={
          '# Pizza\nMargherita 8,50 | Tomate, Mozzarella\nSalami 9,50\n\noder direkt von Lieferando:\nPizza Funghi\nmit Champignons\n9,90 €'
        }
      />
      {deferred.trim() && (
        <div className="bg-muted/30 max-h-72 overflow-y-auto rounded-xl border p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
            <FileText className="text-primary size-3.5" /> {preview.dishes.length} Gerichte erkannt
            {preview.errors.length > 0 && (
              <span className="text-warning">· {preview.errors.length} Zeilen übersprungen</span>
            )}
          </div>
          <ul className="divide-border/50 divide-y text-sm">
            {preview.dishes.map((dish, index) => (
              <li key={index} className="flex items-baseline gap-2 py-1">
                {dish.category && (
                  <span className="text-primary shrink-0 text-[10px] font-bold tracking-wider uppercase">
                    {dish.category}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{dish.name}</span>
                <span className="shrink-0 tabular-nums">{formatEuro(dish.priceCents)}</span>
              </li>
            ))}
          </ul>
          {preview.errors.length > 0 && (
            <ul className="text-warning mt-2 space-y-0.5 text-xs">
              {preview.errors.slice(0, 8).map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || preview.dishes.length === 0}>
          <ClipboardPaste />{' '}
          {preview.dishes.length > 0
            ? `${preview.dishes.length} Gerichte übernehmen`
            : 'Übernehmen'}
        </Button>
        {state && (
          <span className={state.ok ? 'text-success text-sm' : 'text-error text-sm'}>
            {state.ok ? state.message : state.error}
          </span>
        )}
      </div>
      <Hint>Extras wie Größen oder Beläge kannst du danach pro Gericht ergänzen.</Hint>
    </form>
  );
}
