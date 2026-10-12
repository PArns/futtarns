'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Re-renders the server page every few seconds while it waits on something outside the
 * app, such as the bot being linked. A hidden tab does not ask: each WhatsApp pairing
 * code also sends the phone a notification.
 */
export function AutoRefresh({ everyMs = 5_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
