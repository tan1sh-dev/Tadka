import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Loader2, Star, X } from 'lucide-react';
import { create } from 'zustand';
import type { ItemDiet } from '@tadka/shared';

// ── Button ──────────────────────────────────────────────────────────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-paper',
  ghost: 'text-ink-2 hover:bg-ink/5',
  danger: 'bg-chili-600 text-white hover:brightness-110',
  success: 'bg-leaf-600 text-white hover:bg-leaf-700',
};
const sizes = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-5 text-base gap-2' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: keyof typeof sizes;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        'inline-flex items-center justify-center rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 select-none',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

// ── Form fields ─────────────────────────────────────────────────────────────
export function Field({ label, error, hint, children, id }: { label: string; error?: string; hint?: string; children: (id: string, describedBy?: string) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy = error ? `${fid}-err` : hint ? `${fid}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={fid} className="block text-sm font-medium text-ink-2">
        {label}
      </label>
      {children(fid, describedBy)}
      {error ? (
        <p id={`${fid}-err`} role="alert" className="text-xs font-medium text-chili-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fid}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputBase =
  'w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70 transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 aria-[invalid=true]:border-chili-600';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx(inputBase, 'h-11', className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={clsx(inputBase, 'py-2.5 min-h-20', className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={clsx(inputBase, 'h-11 pr-8', className)} {...p} />;
});

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-leaf-600' : 'bg-line-strong')}
    >
      <span className={clsx('absolute top-1 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-6' : 'left-1')} />
    </button>
  );
}

// ── Feedback ────────────────────────────────────────────────────────────────
export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'leaf' | 'chili' | 'turmeric' | 'ink'; className?: string }) {
  const tones = {
    neutral: 'bg-ink/5 text-ink-2',
    brand: 'bg-brand-50 text-brand-700',
    leaf: 'bg-leaf-50 text-leaf-700',
    chili: 'bg-chili-50 text-chili-600',
    turmeric: 'bg-turmeric-100 text-turmeric-600',
    ink: 'bg-ink text-white',
  };
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-muted">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={clsx('relative overflow-hidden rounded-xl bg-line/70', className)}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">{icon}</div>}
      <h3 className="text-lg font-bold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
      <AlertTriangle className="size-7 text-chili-600" aria-hidden />
      <p className="font-semibold">We couldn’t load this</p>
      <p className="max-w-sm text-sm text-muted">{error instanceof Error ? error.message : 'Unexpected error'}</p>
      {retry && (
        <Button variant="secondary" size="sm" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'error' | 'success'; title?: string; children: ReactNode }) {
  const tones = {
    info: 'bg-turmeric-100/60 border-turmeric-400/40 text-ink-2',
    warn: 'bg-turmeric-100 border-turmeric-400 text-ink',
    error: 'bg-chili-50 border-chili-600/30 text-chili-600',
    success: 'bg-leaf-50 border-leaf-600/30 text-leaf-700',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={clsx('rounded-xl border px-3.5 py-2.5 text-sm', tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={clsx(title && 'mt-0.5')}>{children}</div>
    </div>
  );
}

// ── Modal (native <dialog>: focus trap, Esc, inert background) ───────────────
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className={clsx(
        'm-0 mt-auto w-full max-w-none rounded-t-3xl bg-surface p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-ink/50 backdrop:backdrop-blur-[2px] sm:m-auto sm:rounded-3xl',
        wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[88dvh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="grid size-9 place-items-center rounded-full hover:bg-ink/5" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="border-t border-line px-5 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ── Domain bits ─────────────────────────────────────────────────────────────
/** Indian food-label convention: square with a dot (veg) / triangle (non-veg) / amber (egg). */
export function DietMark({ diet, className }: { diet: ItemDiet; className?: string }) {
  const color = diet === 'veg' ? 'var(--color-leaf-600)' : diet === 'egg' ? 'var(--color-egg-600)' : 'var(--color-chili-600)';
  const label = diet === 'veg' ? 'Vegetarian' : diet === 'egg' ? 'Contains egg' : 'Non-vegetarian';
  return (
    <span role="img" aria-label={label} title={label} className={clsx('inline-grid size-4 shrink-0 place-items-center rounded-[3px] border-[1.5px]', className)} style={{ borderColor: color }}>
      {diet === 'nonveg' ? (
        <svg viewBox="0 0 10 10" className="size-2.5">
          <path d="M5 1.5 9 8.5H1z" fill={color} />
        </svg>
      ) : (
        <span className="size-2 rounded-full" style={{ background: color }} />
      )}
    </span>
  );
}

export function Rating({ avg, count, compact }: { avg: number; count: number; compact?: boolean }) {
  if (!count) return <span className="text-xs font-medium text-muted">New</span>;
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold" aria-label={`Rated ${avg} out of 5 from ${count} reviews`}>
      <span className={clsx('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-white', avg >= 4 ? 'bg-leaf-600' : avg >= 3 ? 'bg-turmeric-600' : 'bg-chili-600')}>
        {avg.toFixed(1)}
        <Star className="size-3 fill-current" aria-hidden />
      </span>
      {!compact && <span className="text-xs font-normal text-muted">({count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count})</span>}
    </span>
  );
}

// ── Toasts ──────────────────────────────────────────────────────────────────
interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}
const useToasts = create<{ items: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }>((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items.slice(-2), { ...t, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), 4500);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (message: string) => useToasts.getState().push({ message, tone: 'success' }),
  error: (message: string) => useToasts.getState().push({ message, tone: 'error' }),
  info: (message: string) => useToasts.getState().push({ message, tone: 'info' }),
};

export function Toaster() {
  const { items, dismiss } = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6">
      {items.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto flex max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-[var(--shadow-pop)]',
            t.tone === 'error' ? 'bg-chili-600' : t.tone === 'success' ? 'bg-leaf-700' : 'bg-ink',
          )}
        >
          <span className="flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="opacity-80 hover:opacity-100">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p className="num mt-1 font-display text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
