'use client';

import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { archiveRestaurantAction, deleteRestaurantAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { useAction } from '@/lib/hooks/use-action';

/** Take a restaurant off the list, bring it back, or delete it for good. */
export function RestaurantActions({
  id,
  name,
  archived,
}: {
  id: number;
  name: string;
  archived: boolean;
}) {
  const { pending, execute } = useAction();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (
            archived ||
            window.confirm(
              `${name} aus dem Angebot nehmen? Es verschwindet aus der Liste und kann nicht mehr ausgesucht werden. Alte Bestellungen bleiben.`
            )
          ) {
            execute(() => archiveRestaurantAction(id, !archived));
          }
        }}
      >
        {archived ? <ArchiveRestore /> : <Archive />}
        {archived ? 'Wieder anbieten' : 'Nicht mehr anbieten'}
      </Button>
      <Button
        variant="ghost"
        className="text-error"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`${name} mit der ganzen Karte endgültig löschen?`)) {
            execute(() => deleteRestaurantAction(id));
          }
        }}
      >
        <Trash2 /> Löschen
      </Button>
    </div>
  );
}
