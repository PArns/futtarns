import { cn } from '@/lib/utils';

/** The pin with a slice of pizza: park.fan's pin shape in its blue, toppings in its green. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 29 40" aria-hidden className={cn('h-[26px] w-auto', className)}>
      <defs>
        <linearGradient id="brand-pin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#12bef0" />
          <stop offset="1" stopColor="#1665e6" />
        </linearGradient>
      </defs>
      <path
        d="M14.5 0C6.5 0 0 6.4 0 14.3c0 10.2 12.3 24 13.1 24.9a1.9 1.9 0 0 0 2.8 0C16.7 38.3 29 24.5 29 14.3 29 6.4 22.5 0 14.5 0z"
        fill="url(#brand-pin)"
      />
      <path d="M7.4 8.9c4.5-2 9.7-2 14.2 0L14.5 23.8z" fill="#fff" />
      <path
        d="M7.4 8.9c4.5-2 9.7-2 14.2 0"
        fill="none"
        stroke="#ffe2a8"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12.4" cy="11.9" r="1.3" fill="#51cc64" />
      <circle cx="16.6" cy="12.5" r="1.15" fill="#51cc64" />
      <circle cx="14.4" cy="16.6" r="1.1" fill="#51cc64" />
    </svg>
  );
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <BrandMark />
      <span className="text-[19px] leading-none font-extrabold tracking-[-0.03em]">
        freitach<span className="text-primary">.</span>
      </span>
    </span>
  );
}
