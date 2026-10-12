'use client';

import { useTransition } from 'react';
import { useToast } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';

/** Runs a server action in a transition and reports its outcome as a toast. */
export function useAction() {
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  function execute(
    action: () => Promise<ActionResult>,
    onSuccess?: (result: ActionResult) => void
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error);
      else {
        if (result.message) toast.success(result.message);
        onSuccess?.(result);
      }
    });
  }
  return { pending, execute };
}
