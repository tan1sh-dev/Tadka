import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { loginSchema, registerSchema, type RegisterInput } from '@tadka/shared';
import { api, fieldErrors } from '../../lib/api';
import { resetSocket } from '../../lib/socket';
import type { Me } from '../../lib/types';
import { errorMessage } from '../../lib/format';
import { homeFor } from '../../hooks/useAuth';
import { Button, Field, Input, Notice } from '../../components/ui';
import { Logo } from '../../components/Logo';

function safeNext(next: string | null, role: Me['role']) {
  // Only allow same-site relative paths (no open redirects).
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return homeFor(role);
}

function AuthShell({ title, sub, children }: { title: string; sub: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md pt-6">
      <div className="mb-6 flex justify-center">
        <Logo />
      </div>
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold">{title}</h1>
        <p className="mt-1 text-sm text-muted">{sub}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState } = useForm<z.input<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const submit = handleSubmit(async (v) => {
    setError('');
    try {
      const r = await api<{ user: Me }>('/auth/login', { method: 'POST', body: v });
      resetSocket();
      await qc.invalidateQueries();
      nav(safeNext(params.get('next'), r.user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  return (
    <AuthShell
      title="Welcome back"
      sub={
        <>
          New here?{' '}
          <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} className="font-semibold text-brand-700 underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" error={formState.errors.email?.message}>
          {(id, d) => <Input id={id} type="email" autoComplete="email" aria-describedby={d} aria-invalid={!!formState.errors.email} {...register('email')} />}
        </Field>
        <Field label="Password" error={formState.errors.password?.message}>
          {(id, d) => <Input id={id} type="password" autoComplete="current-password" aria-describedby={d} {...register('password')} />}
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" block size="lg" loading={formState.isSubmitting}>
          Log in
        </Button>
      </form>
      {import.meta.env.DEV && (
        <p className="mt-5 rounded-xl bg-paper p-3 text-xs text-muted">
          Dev seed accounts (password <code>Tadka@2026</code>): customer@, owner@, rider@, admin@tadka.dev
        </p>
      )}
    </AuthShell>
  );
}

const ROLE_COPY = {
  customer: { title: 'Create your account', sub: 'Order from local kitchens with prices you can trust.' },
  restaurant: { title: 'List your restaurant', sub: 'Create an owner account, then add your FSSAI details and menu. We verify every restaurant before it goes live.' },
  delivery: { title: 'Deliver with Tadka', sub: 'Create a partner account. We review new partners before you can go online.' },
} as const;

export function RegisterPage({ role = 'customer' }: { role?: 'customer' | 'restaurant' | 'delivery' }) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const { register, handleSubmit, setError: setFieldError, formState } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role, smsOptIn: true },
  });
  const submit = handleSubmit(async (v) => {
    setError('');
    try {
      const r = await api<{ user: Me }>('/auth/register', { method: 'POST', body: { ...v, role } });
      resetSocket();
      await qc.invalidateQueries();
      nav(role === 'restaurant' ? '/partner/restaurant/onboarding' : safeNext(params.get('next'), r.user.role), { replace: true });
    } catch (err) {
      const fe = fieldErrors(err);
      Object.entries(fe).forEach(([k, m]) => setFieldError(k as keyof RegisterInput, { message: m }));
      if (!Object.keys(fe).length) setError(errorMessage(err));
    }
  });
  const e = formState.errors;
  return (
    <AuthShell
      title={ROLE_COPY[role].title}
      sub={
        <>
          {ROLE_COPY[role].sub} Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-700 underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" error={e.name?.message}>
          {(id, d) => <Input id={id} autoComplete="name" aria-describedby={d} aria-invalid={!!e.name} {...register('name')} />}
        </Field>
        <Field label="Email" error={e.email?.message}>
          {(id, d) => <Input id={id} type="email" autoComplete="email" aria-describedby={d} aria-invalid={!!e.email} {...register('email')} />}
        </Field>
        <Field label="Mobile number" hint="10-digit Indian mobile. Used for order updates." error={e.phone?.message}>
          {(id, d) => (
            <div className="flex">
              <span className="grid place-items-center rounded-l-xl border border-r-0 border-line-strong bg-paper px-3 text-sm text-muted">+91</span>
              <Input id={id} type="tel" inputMode="numeric" autoComplete="tel-national" aria-describedby={d} aria-invalid={!!e.phone} className="rounded-l-none" {...register('phone')} />
            </div>
          )}
        </Field>
        <Field label="Password" hint="At least 8 characters" error={e.password?.message}>
          {(id, d) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={!!e.password} {...register('password')} />}
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand-500)]" {...register('smsOptIn')} />
          <span>Send me SMS updates about my orders. Transactional only, no marketing. You can turn this off any time.</span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" block size="lg" loading={formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
