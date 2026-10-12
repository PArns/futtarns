'use client';

import { Trash2 } from 'lucide-react';
import { removeDefaultAction } from '@/app/actions';
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
