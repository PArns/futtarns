'use client';

import { HandHeart } from 'lucide-react';
import { takeOverAction } from '@/app/actions';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useAction } from '@/lib/hooks/use-action';

/**
 * Steps in as host for a Friday whose host is away or missing, or instead of the usual host;
 * `confirm` asks first, for when someone else would have hosted.
 */
export function TakeOverButton({
  date,
  confirm,
  variant,
}: {
  date: string;
  confirm?: string;
  variant?: ButtonProps['variant'];
}) {
  const { pending, execute } = useAction();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        execute(() => takeOverAction(date));
      }}
    >
      <HandHeart /> Ich übernehme
    </Button>
  );
}
