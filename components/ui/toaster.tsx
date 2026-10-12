'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Toast = { id: number; kind: 'success' | 'error'; text: string; leaving: boolean };
type ToastApi = { success: (text: string) => void; error: (text: string) => void };

const ToastContext = createContext<ToastApi | null>(null);

const SHOW_MS = 3500;
const FADE_MS = 250;
let nextId = 1;

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = nextId++;
    setToasts((list) => [...list.slice(-2), { id, kind, text, leaving: false }]);
    setTimeout(() => {
      setToasts((list) =>
        list.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast))
      );
      setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), FADE_MS);
    }, SHOW_MS);
  }, []);

  const [api] = useState<ToastApi>(() => ({
    success: (text) => push('success', text),
    error: (text) => push('error', text),
  }));

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'glass-tile flex max-w-md items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-xl transition-[opacity,translate] duration-250 starting:translate-y-2 starting:opacity-0',
              toast.leaving && 'translate-y-2 opacity-0'
            )}
          >
            {toast.kind === 'success' ? (
              <CircleCheck className="text-success size-4 shrink-0" />
            ) : (
              <CircleAlert className="text-error size-4 shrink-0" />
            )}
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast needs <Toaster>');
  return api;
}
