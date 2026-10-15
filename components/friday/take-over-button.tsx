'use client';

import { HandHeart } from 'lucide-react';
import { takeOverAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { useAction } from '@/lib/hooks/use-action';

/** Steps in as host for a Friday whose host is away. */
export function TakeOverButton({ date }: { date: string }) {
  const { pending, execute } = useAction();
  return (
    <Button size="sm" disabled={pending} onClick={() => execute(() => takeOverAction(date))}>
      <HandHeart /> Ich übernehme
    </Button>
  );
}
