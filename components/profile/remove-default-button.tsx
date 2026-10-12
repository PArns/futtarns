'use client';

import { Ban, Trash2 } from 'lucide-react';
import { removeDefaultAction, setNoFoodDefaultAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { useAction } from '@/lib/hooks/use-action';

export function RemoveDefaultButton({ restaurantId }: { restaurantId: number }) {
  const { pending, execute } = useAction();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Standard entfernen"
      disabled={pending}
      onClick={() => execute(() => removeDefaultAction(restaurantId))}
    >
      <Trash2 />
    </Button>
  );
}

/** Makes „nix“ the default here: saying nothing then means coming without food. */
export function NoFoodDefaultButton({ restaurantId }: { restaurantId: number }) {
  const { pending, execute } = useAction();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => execute(() => setNoFoodDefaultAction(restaurantId))}
    >
      <Ban /> Nix essen
    </Button>
  );
}
