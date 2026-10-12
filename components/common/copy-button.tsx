'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';

export function CopyButton({
  text,
  label = 'Kopieren',
  ...props
}: { text: string; label?: string } & ButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      {...props}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
      {copied ? 'Kopiert' : label}
    </Button>
  );
}
