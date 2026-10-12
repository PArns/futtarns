'use client';

import { ArrowLeft, ArrowRight, MessageCircle, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { requestCodeAction, verifyCodeAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Phone number first, then the six digits the bot sent on WhatsApp. */
export function LoginForm({
  initialPhone,
  initialCode,
}: {
  initialPhone: string;
  initialCode: string;
}) {
  const [step, setStep] = useState<'phone' | 'code'>(
    initialPhone && initialCode ? 'code' : 'phone'
  );
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const autoSubmitted = useRef(false);

  function verify(value: string) {
    setError(null);
    startTransition(async () => {
      const result = await verifyCodeAction(phone, value);
      // On success the action redirects; a result only comes back on failure.
      if (result && !result.ok) setError(result.error);
    });
  }

  // A link from WhatsApp carries number and code; signing in should take no extra tap.
  useEffect(() => {
    if (initialPhone && initialCode && !autoSubmitted.current) {
      autoSubmitted.current = true;
      verify(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the link's values
  }, []);

  if (step === 'phone') {
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await requestCodeAction(phone);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setInfo(result.message ?? null);
            setCode('');
            setStep('code');
          });
        }}
      >
        <div>
          <h1 className="text-xl font-bold">Anmelden</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Gib deine Handynummer ein. Du bekommst einen Code per WhatsApp.
          </p>
        </div>
        <Label>
          Handynummer
          <div className="relative">
            <Smartphone className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="0170 1234567"
              className="h-12 pl-9 text-lg max-sm:h-12"
            />
          </div>
        </Label>
        {error && <p className="text-error text-sm font-medium">{error}</p>}
        <Button type="submit" size="xl" className="w-full" disabled={pending || !phone.trim()}>
          <MessageCircle /> Code per WhatsApp schicken
        </Button>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        verify(code);
      }}
    >
      <div>
        <h1 className="text-xl font-bold">Code eingeben</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Wir haben dir einen sechsstelligen Code an{' '}
          <strong className="text-foreground">{phone}</strong> geschickt.
        </p>
      </div>
      {info && (
        <p className="border-success/40 bg-success/10 text-success rounded-xl border px-3 py-2 text-sm font-medium">
          {info}
        </p>
      )}
      <Input
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={code}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          if (digits.length === 6) verify(digits);
        }}
        placeholder="••••••"
        aria-label="Code"
        className={cn(
          'h-16 text-center text-3xl font-extrabold tracking-[0.5em] tabular-nums max-sm:h-16',
          error && 'border-error'
        )}
      />
      {error && <p className="text-error text-sm font-medium">{error}</p>}
      <Button type="submit" size="xl" className="w-full" disabled={pending || code.length !== 6}>
        Anmelden <ArrowRight />
      </Button>
      <button
        type="button"
        onClick={() => {
          setStep('phone');
          setError(null);
          setInfo(null);
        }}
        className="text-muted-foreground hover:text-foreground mx-auto flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-3.5" /> Andere Nummer oder neuer Code
      </button>
    </form>
  );
}
