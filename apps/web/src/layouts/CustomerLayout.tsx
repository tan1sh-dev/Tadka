import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import clsx from 'clsx';
import { ChevronDown, Home, MapPin, Receipt, Search, ShoppingBag, User } from 'lucide-react';
import { useMe } from '../hooks/useAuth';
import { cartCount, useCart, useLocationStore } from '../lib/stores';
import { LocationPicker } from '../components/LocationPicker';
import { Logo } from '../components/Logo';

export function CustomerLayout() {
  const { data: me } = useMe();
  const location = useLocationStore((s) => s.location);
  const lines = useCart((s) => s.lines);
  const [picker, setPicker] = useState(false);
  const count = cartCount(lines);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const [q, setQ] = useState(params.get('q') ?? '');

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Logo />
          <button onClick={() => setPicker(true)} className="flex min-w-0 items-center gap-1.5 rounded-xl px-2 py-1.5 text-left hover:bg-ink/5" aria-label="Change delivery location">
            <MapPin className="size-4 shrink-0 text-brand-600" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">Deliver to</span>
              <span className="block max-w-[38vw] truncate text-sm font-semibold sm:max-w-56">{location?.label ?? 'Choose location'}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
          </button>
          <form
            role="search"
            className="ml-auto hidden flex-1 md:block md:max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              nav(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search');
            }}
          >
            <label className="relative block">
              <span className="sr-only">Search for a dish, restaurant or craving</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Try “spicy veg under 200” or “biryani”"
                className="h-11 w-full rounded-xl border border-line-strong bg-surface pl-10 pr-3 text-[15px] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
              />
            </label>
          </form>
          <nav className="ml-auto hidden items-center gap-1 md:ml-0 md:flex" aria-label="Account">
            {me?.role === 'customer' && (
              <NavLink to="/orders" className="rounded-xl px-3 py-2 text-sm font-semibold hover:bg-ink/5">
                Orders
              </NavLink>
            )}
            <NavLink to={me ? '/account' : '/login'} className="rounded-xl px-3 py-2 text-sm font-semibold hover:bg-ink/5">
              {me ? me.name.split(' ')[0] : 'Log in'}
            </NavLink>
            <Link to="/checkout" className="relative inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-2" aria-label={`Cart, ${count} items`}>
              <ShoppingBag className="size-4" aria-hidden /> Cart
              {count > 0 && <span className="num grid min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-xs">{count}</span>}
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 md:pb-12">
        <Outlet />
      </main>

      <footer className="hidden border-t border-line py-8 text-sm text-muted md:block">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-4">
          <p>
            <span className="font-display font-bold text-ink">Tadka</span> — honest food delivery. Prices include all fees shown before you pay.
          </p>
          <p className="flex gap-4">
            <Link to="/partner/join" className="hover:text-ink">
              Partner with us
            </Link>
            <Link to="/support" className="hover:text-ink">
              Help & support
            </Link>
          </p>
        </div>
      </footer>

      {/* Mobile bottom navigation */}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="grid grid-cols-4">
          {[
            { to: '/', icon: Home, label: 'Home', end: true },
            { to: '/search', icon: Search, label: 'Search' },
            { to: '/orders', icon: Receipt, label: 'Orders' },
            { to: me ? '/account' : '/login', icon: User, label: me ? 'Account' : 'Log in' },
          ].map(({ to, icon: Icon, label, end }) => (
            <NavLink key={label} to={to} end={end} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold', isActive ? 'text-brand-600' : 'text-muted')}>
              <Icon className="size-5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      {count > 0 && pathname !== '/checkout' && (
        <Link
          to="/checkout"
          className="fixed inset-x-3 bottom-[72px] z-30 flex items-center justify-between rounded-2xl bg-leaf-700 px-4 py-3 text-white shadow-[var(--shadow-pop)] md:hidden"
        >
          <span className="text-sm font-semibold">
            {count} item{count > 1 ? 's' : ''} · {useCart.getState().restaurant?.name}
          </span>
          <span className="inline-flex items-center gap-1 text-sm font-bold">
            View cart <ShoppingBag className="size-4" aria-hidden />
          </span>
        </Link>
      )}
      <LocationPicker open={picker} onClose={() => setPicker(false)} />
    </div>
  );
}
