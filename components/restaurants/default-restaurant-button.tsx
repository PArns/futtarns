'use client';

import { Star } from 'lucide-react';
import { setHostRestaurantAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { useAction } from '@/lib/hooks/use-action';

/** Makes this restaurant the one the viewer's Fridays order from when nobody picks another. */
export function DefaultRestaurantButton({ id }: { id: number }) {
  const { pending, execute } = useAction();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => execute(() => setHostRestaurantAction(id))}
    >
      <Star /> Mein Standard als Gastgeber
    </Button>
  );
}
