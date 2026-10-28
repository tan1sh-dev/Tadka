import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Home, LogOut, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { ALLERGEN_LABELS, ALLERGENS, PROFILE_DIETS, PROFILE_DIET_LABELS, type Allergen, type DietaryProfile } from '@tadka/shared';
import { api } from '../../lib/api';
import type { Address } from '../../lib/types';
import { errorMessage } from '../../lib/format';
import { homeFor, useLogout, useMe } from '../../hooks/useAuth';
import { Button, Modal, Notice, Spinner, Toggle, toast } from '../../components/ui';
import { AddressForm } from '../../components/AddressForm';

export function AccountPage() {
  const { data: me, isLoading } = useMe();
  const logout = useLogout();
  if (isLoading) return <Spinner />;
  if (!me) return <Navigate to="/login?next=/account" replace />;
  if (me.role !== 'customer')
    return (
      <Notice>
        You’re signed in as a {me.role}. <Link className="font-semibold underline" to={homeFor(me.role)}>Go to your dashboard</Link>
      </Notice>
    );
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">{me.name}</h1>
          <p className="text-sm text-muted">
            {me.email} · {me.phone}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={logout}>
          <LogOut className="size-4" /> Log out
        </Button>
      </div>
      <DietaryGuardCard profile={me.dietary} />
      <AddressesCard />
      <NotificationsCard smsOptIn={me.smsOptIn} />
    </div>
  );
}

function DietaryGuardCard({ profile }: { profile: DietaryProfile }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile]);
  const save = useMutation({
    mutationFn: (dietary: DietaryProfile) => api('/users/me', { method: 'PATCH', body: { dietary } }),
    onSuccess: () => {
      toast.success('Dietary Guard updated');
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
  return (
    <section className="card p-5" aria-labelledby="dg-h">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="dg-h" className="flex items-center gap-2 text-lg font-bold">
            <ShieldCheck className="size-5 text-leaf-600" aria-hidden /> Dietary Guard
          </h2>
          <p className="mt-1 text-sm text-muted">When on, dishes that don’t fit are marked on every menu and can’t be ordered, even through add-ons. Recommendations never override it.</p>
        </div>
        <Toggle checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} label="Enable Dietary Guard" />
      </div>
      <fieldset className={clsx('mt-4 space-y-4', !draft.enabled && 'pointer-events-none opacity-50')} disabled={!draft.enabled}>
        <div>
          <legend className="mb-2 text-sm font-semibold">I eat</legend>
          <div className="flex flex-wrap gap-2">
            {PROFILE_DIETS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={draft.diet === d}
                onClick={() => setDraft({ ...draft, diet: d })}
                className={clsx('rounded-full border px-3 py-1.5 text-sm font-medium', draft.diet === d ? 'border-leaf-600 bg-leaf-50 text-leaf-700' : 'border-line-strong')}
              >
                {PROFILE_DIET_LABELS[d]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Avoid allergens</p>
          <div className="flex flex-wrap gap-2">
            {ALLERGENS.map((a) => {
              const on = draft.avoidAllergens.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDraft({ ...draft, avoidAllergens: on ? draft.avoidAllergens.filter((x) => x !== a) : [...draft.avoidAllergens, a as Allergen] })}
                  className={clsx('rounded-full border px-3 py-1.5 text-sm font-medium', on ? 'border-chili-600 bg-chili-50 text-chili-600' : 'border-line-strong')}
                >
                  {ALLERGEN_LABELS[a]}
                </button>
              );
            })}
          </div>
        </div>
      </fieldset>
      <p className="mt-4 text-xs text-muted">Ingredient and allergen information is declared by restaurants. For severe allergies, please also confirm with the restaurant.</p>
      <Button className="mt-3" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(draft)}>
        Save
      </Button>
    </section>
  );
}

function AddressesCard() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['addresses'], queryFn: () => api<{ addresses: Address[] }>('/addresses').then((r) => r.addresses) });
  const del = useMutation({
    mutationFn: (id: string) => api(`/addresses/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <section className="card p-5" aria-labelledby="addr-h">
      <div className="flex items-center justify-between">
        <h2 id="addr-h" className="text-lg font-bold">
          Saved addresses
        </h2>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Add
        </Button>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {list.data?.map((a) => (
          <li key={a.id} className="flex items-start gap-3 py-3 text-sm">
            <Home className="mt-0.5 size-4 text-muted" aria-hidden />
            <span className="flex-1">
              <span className="font-semibold">{a.label}</span>
              {a.serviceable === false && <span className="ml-2 text-xs font-semibold text-chili-600">outside delivery zone</span>}
              <span className="block text-muted">
                {a.line1}, {a.locality}
                {a.landmark ? ` (${a.landmark})` : ''}, {a.city} {a.pincode}
              </span>
            </span>
            <button onClick={() => del.mutate(a.id)} aria-label={`Delete ${a.label} address`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-chili-50 hover:text-chili-600">
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {list.data?.length === 0 && <li className="py-3 text-sm text-muted">No saved addresses yet.</li>}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title="Add address" wide>
        <AddressForm
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ['addresses'] });
          }}
        />
      </Modal>
    </section>
  );
}

function NotificationsCard({ smsOptIn }: { smsOptIn: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: boolean) => api('/users/me', { method: 'PATCH', body: { smsOptIn: v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  return (
    <section className="card flex items-center justify-between gap-4 p-5">
      <div>
        <h2 className="text-lg font-bold">SMS order updates</h2>
        <p className="text-sm text-muted">Payment, acceptance, pickup OTP and delivery. Transactional only.</p>
      </div>
      <Toggle checked={smsOptIn} onChange={(v) => m.mutate(v)} label="SMS order updates" disabled={m.isPending} />
    </section>
  );
}
