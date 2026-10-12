'use client';

import { Bookmark } from 'lucide-react';
import { useEffect, useRef } from 'react';

/**
 * Runs on the Lieferando page in the user's own browser (which gets past Lieferando's bot
 * wall), takes the visible menu text, marks the category headings with „#“ and opens this
 * restaurant's page with it, where the import preview takes over.
 */
function bookmarkletSource(target: string): string {
  return `javascript:(()=>{const h=new Set([...document.querySelectorAll('h2')].map(e=>e.innerText.trim()));const t=document.body.innerText.split('\\n').map(l=>h.has(l.trim())?'# '+l.trim():l).join('\\n');window.open(${JSON.stringify(target)}+encodeURIComponent(t),'_blank')})()`;
}

export function LieferandoBookmarklet({ restaurantId }: { restaurantId: number }) {
  const ref = useRef<HTMLAnchorElement>(null);

  // React refuses javascript: links in JSX, so the bookmarklet is set on the element itself.
  useEffect(() => {
    ref.current?.setAttribute(
      'href',
      bookmarkletSource(`${window.location.origin}/restaurants/${restaurantId}#import=`)
    );
  }, [restaurantId]);

  return (
    <div className="border-primary/30 bg-primary/5 space-y-3 rounded-xl border p-4 text-sm">
      <div className="font-semibold">Automatisch übernehmen (am Rechner)</div>
      <ol className="text-muted-foreground list-inside list-decimal space-y-1">
        <li>Den Button unten in die Lesezeichenleiste ziehen (einmalig).</li>
        <li>Die Speisekarte des Restaurants bei Lieferando öffnen und ganz nach unten scrollen.</li>
        <li>Auf das Lesezeichen klicken – hier öffnet sich die Vorschau.</li>
      </ol>
      <a
        ref={ref}
        onClick={(event) => event.preventDefault()}
        className="bg-primary text-primary-foreground inline-flex h-9 cursor-grab items-center gap-2 rounded-md px-4 text-sm font-medium"
      >
        <Bookmark className="size-4" /> Speisekarte holen
      </a>
    </div>
  );
}
