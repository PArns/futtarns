'use client';

import { MessageCircle } from 'lucide-react';
import { CopyButton } from '@/components/common/copy-button';
import { buttonVariants } from '@/components/ui/button';

function whatsappLink(phone: string | null, text: string): string {
  const digits = phone?.replace(/[^\d]/g, '').replace(/^00/, '').replace(/^0/, '49') ?? '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** A freshly issued login link, shown once, with ways to hand it over. */
export function LoginLink({
  name,
  link,
  phone,
}: {
  name: string;
  link: string;
  phone: string | null;
}) {
  const message = `Hi ${name}, hier ist dein Link für den Freitag: ${link}`;
  return (
    <div className="border-success/40 bg-success/10 space-y-2 rounded-xl border p-3">
      <p className="text-xs font-semibold">Login-Link für {name}. Er wird nur jetzt angezeigt:</p>
      <code className="bg-background/60 block truncate rounded-md px-2 py-1.5 text-xs">{link}</code>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={link} />
        <a
          href={whatsappLink(phone, message)}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: 'success', size: 'sm' })}
        >
          <MessageCircle /> Per WhatsApp schicken
        </a>
      </div>
    </div>
  );
}
