import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import clsx from 'clsx';
import { LogOut, ShieldAlert, type LucideIcon } from 'lucide-react';
import type { Role } from '@tadka/shared';
import { useLogout, useMe } from '../hooks/useAuth';
import { Logo } from '../components/Logo';
import { Button, EmptyState, Spinner } from '../components/ui';
import { useSocketStatus } from '../lib/socket';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Shared shell for the operational apps (restaurant, delivery, admin). Server still enforces every permission. */
export function DashboardLayout({ role, title, nav, live }: { role: Role; title: string; nav: NavItem[]; live?: boolean }) {
  const { data: me, isLoading } = useMe();
  const logout = useLogout();
  const { pathname } = useLocation();
  if (isLoading) return <Spinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />;
  if (me.role !== role)
    return (
      <div className="mx-auto max-w-md pt-20">
        <EmptyState icon={<ShieldAlert />} title="This area isn’t for your account" body={`You’re signed in as a ${me.role}. ${title} needs a ${role} account.`} action={<Button onClick={logout}>Switch account</Button>} />
      </div>
    );
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 z-30 border-b border-line bg-surface md:h-dvh md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-2 px-4 py-3 md:py-5">
          <Logo to={nav[0].to} sub={title} />
          <div className="flex items-center gap-2 md:hidden">
            {live && <LiveDot />}
            <button onClick={logout} className="grid size-9 place-items-center rounded-lg hover:bg-ink/5" aria-label="Log out">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
        <nav aria-label={title} className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3 md:pb-0">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx('flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold', isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-2 hover:bg-ink/5')
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute inset-x-3 bottom-4 hidden space-y-3 md:block">
          {live && <LiveDot />}
          <div className="rounded-xl bg-paper p-3 text-sm">
            <p className="truncate font-semibold">{me.name}</p>
            <p className="truncate text-xs text-muted">{me.email}</p>
            <button onClick={logout} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:underline">
              <LogOut className="size-3.5" /> Log out
            </button>
          </div>
        </div>
      </aside>
      <main id="main" className="min-w-0 px-4 py-6 md:px-8">
        <Outlet />
      </main>
    </div>
  );
}

function LiveDot() {
  const connected = useSocketStatus();
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold', connected ? 'bg-leaf-50 text-leaf-700' : 'bg-chili-50 text-chili-600')} role="status">
      <span className={clsx('size-2 rounded-full', connected ? 'bg-leaf-600' : 'bg-chili-600')} />
      {connected ? 'Live' : 'Reconnecting…'}
    </span>
  );
}
