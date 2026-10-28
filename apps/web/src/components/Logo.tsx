import { Link } from 'react-router';

export function Logo({ to = '/', sub }: { to?: string; sub?: string }) {
  return (
    <Link to={to} className="flex shrink-0 items-center gap-2" aria-label="Tadka home">
      <svg viewBox="0 0 64 64" className="size-9" aria-hidden>
        <rect width="64" height="64" rx="16" fill="#e2531d" />
        <path d="M20 40c0-9 5-16 12-16s12 7 12 16" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" />
        <circle cx="26" cy="18" r="3" fill="#f2b33d" />
        <circle cx="34" cy="14" r="3" fill="#f2b33d" />
        <circle cx="40" cy="20" r="3" fill="#f2b33d" />
        <rect x="14" y="40" width="36" height="6" rx="3" fill="#fff" />
      </svg>
      <span className="hidden leading-none sm:block">
        <span className="block font-display text-xl font-extrabold tracking-tight">tadka</span>
        {sub && <span className="block text-[10px] font-semibold uppercase tracking-widest text-muted">{sub}</span>}
      </span>
    </Link>
  );
}
