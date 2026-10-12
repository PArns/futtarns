import { cn } from '@/lib/utils';

/** A slice of pizza on a tile in park.fan's blue; the toppings borrow its green. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={cn('h-[26px] w-auto', className)}>
      <defs>
        <linearGradient id="brand-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#12bef0" />
          <stop offset="1" stopColor="#1665e6" />
        </linearGradient>
        <linearGradient id="brand-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill="url(#brand-tile)" />
      <rect width="48" height="48" rx="13" fill="url(#brand-shine)" />
      <g transform="rotate(-18 24 25)">
        <path
          d="M11.5 15.5Q24 9 36.5 15.5L25.4 39.3Q24 41.6 22.6 39.3Z"
          fill="#ffd45c"
          stroke="#f2b33d"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        <path
          d="M10.8 14.2Q24 7 37.2 14.2"
          fill="none"
          stroke="#e39a2d"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle cx="19.2" cy="19.4" r="2.7" fill="#e5484d" />
        <circle cx="28.6" cy="19.8" r="2.5" fill="#e5484d" />
        <circle cx="23.8" cy="28.4" r="2.3" fill="#e5484d" />
        <circle cx="18.4" cy="18.6" r="0.8" fill="#fff" fillOpacity="0.45" />
        <circle cx="27.9" cy="19" r="0.7" fill="#fff" fillOpacity="0.45" />
        <ellipse
          cx="24.6"
          cy="23.2"
          rx="1.9"
          ry="1"
          fill="#51cc64"
          transform="rotate(35 24.6 23.2)"
        />
        <ellipse
          cx="20.6"
          cy="25.2"
          rx="1.5"
          ry="0.8"
          fill="#51cc64"
          transform="rotate(-25 20.6 25.2)"
        />
      </g>
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
