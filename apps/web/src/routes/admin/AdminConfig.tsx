import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { couponSchema, type PricingConfig } from '@tadka/shared';
import { api } from '../../lib/api';
import { errorMessage, formatDate, formatDateTime, inr } from '../../lib/format';
import { Badge, Button, Field, Input, Notice, PageHeader, Select, Spinner, Toggle, toast } from '../../components/ui';
import { ConfirmAction, Table, Td } from './AdminCore';

// ── Promotions ───────────────────────────────────────────────────────────────

interface Coupon {
  id: string;
  code: string;
  description: string;
  type: 'percent' | 'flat' | 'free_delivery';
  value: number;
  maxDiscount: number | null;
  minOrder: number;
  validFrom: string;
  validTo: string;
  active: boolean;
  usageLimit: number | null;
  perUserLimit: number | null;
  firstOrderOnly: boolean;
  usedCount: number;
  restaurantIds: string[];
}

export function AdminPromotionsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'coupons'], queryFn: () => api<{ coupons: Coupon[] }>('/admin/coupons').then((r) => r.coupons) });
  const toggle = useMutation({
    mutationFn: (c: Coupon) => {
      const { id, usedCount: _u, ...rest } = c;
      return api(`/admin/coupons/${id}`, { method: 'PUT', body: { ...rest, active: !c.active } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const describe = (c: Coupon) => (c.type === 'percent' ? `${c.value / 100}% off${c.maxDiscount ? ` up to ${inr(c.maxDiscount, true)}` : ''}` : c.type === 'flat' ? `${inr(c.value, true)} off` : 'Free delivery');
  return (
    <div className="space-y-5">
      <PageHeader title="Promotions" sub="Coupons are platform-funded and validated on the server at quote and order time." />
      <NewCoupon onCreated={() => qc.invalidateQueries({ queryKey: ['admin', 'coupons'] })} />
      {!q.data ? (
        <Spinner />
      ) : (
        <Table head={['Code', 'Offer', 'Min order', 'Valid', 'Used', 'Active']} empty={!q.data.length}>
          {q.data.map((c) => (
            <tr key={c.id}>
              <Td>
                <span className="font-mono font-bold">{c.code}</span>
                {c.firstOrderOnly && <Badge tone="brand" className="ml-1.5">first order</Badge>}
              </Td>
              <Td>{describe(c)}</Td>
              <Td className="num">{inr(c.minOrder, true)}</Td>
              <Td className="whitespace-nowrap text-xs text-muted">
                {formatDate(c.validFrom)} – {formatDate(c.validTo)}
              </Td>
              <Td className="num">
                {c.usedCount}
                {c.usageLimit ? ` / ${c.usageLimit}` : ''}
              </Td>
              <Td>
                <Toggle checked={c.active} onChange={() => toggle.mutate(c)} label={`${c.code} active`} />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function NewCoupon({ onCreated }: { onCreated: () => void }) {
  const [f, setF] = useState({ code: '', description: '', type: 'percent', value: '20', maxDiscount: '100', minOrder: '199', days: '30', perUserLimit: '1', firstOrderOnly: false });
  const [error, setError] = useState('');
  const m = useMutation({
    mutationFn: () => {
      const body = {
        code: f.code,
        description: f.description,
        type: f.type,
        value: f.type === 'percent' ? Math.round(Number(f.value) * 100) : f.type === 'flat' ? Math.round(Number(f.value) * 100) : 0,
        maxDiscount: f.type === 'percent' && f.maxDiscount ? Math.round(Number(f.maxDiscount) * 100) : null,
        minOrder: Math.round(Number(f.minOrder) * 100),
        validFrom: new Date().toISOString(),
        validTo: new Date(Date.now() + Number(f.days) * 86400_000).toISOString(),
        perUserLimit: f.perUserLimit ? Number(f.perUserLimit) : null,
        firstOrderOnly: f.firstOrderOnly,
      };
      const v = couponSchema.safeParse(body);
      if (!v.success) throw new Error(`${v.error.issues[0].path.join('.')}: ${v.error.issues[0].message}`);
      return api('/admin/coupons', { method: 'POST', body });
    },
    onSuccess: () => {
      toast.success('Coupon created');
      setF((s) => ({ ...s, code: '', description: '' }));
      setError('');
      onCreated();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <details className="card p-5">
      <summary className="cursor-pointer font-bold">Create a coupon</summary>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Code (A–Z, 0–9)">{(id) => <Input id={id} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />}</Field>
        <Field label="Type">
          {(id) => (
            <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="percent">Percent off</option>
              <option value="flat">Flat ₹ off</option>
              <option value="free_delivery">Free delivery</option>
            </Select>
          )}
        </Field>
        {f.type !== 'free_delivery' && <Field label={f.type === 'percent' ? 'Percent' : 'Amount (₹)'}>{(id) => <Input id={id} inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}</Field>}
        {f.type === 'percent' && <Field label="Max discount (₹)">{(id) => <Input id={id} inputMode="decimal" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} />}</Field>}
        <Field label="Min order (₹)">{(id) => <Input id={id} inputMode="decimal" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value })} />}</Field>
        <Field label="Valid for (days)">{(id) => <Input id={id} inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />}</Field>
        <Field label="Uses per customer">{(id) => <Input id={id} inputMode="numeric" value={f.perUserLimit} onChange={(e) => setF({ ...f, perUserLimit: e.target.value })} />}</Field>
        <div className="sm:col-span-2">
          <Field label="Description shown to customers">{(id) => <Input id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        </div>
        <label className="flex items-center gap-2 self-end pb-3 text-sm">
          <input type="checkbox" checked={f.firstOrderOnly} onChange={(e) => setF({ ...f, firstOrderOnly: e.target.checked })} className="size-4 accent-[var(--color-brand-500)]" /> First order only
        </label>
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <Button className="mt-4" loading={m.isPending} onClick={() => m.mutate()}>
        Create coupon
      </Button>
    </details>
  );
}

// ── Pricing & zones ──────────────────────────────────────────────────────────

export function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Fees & service areas" sub="Changes apply to new quotes immediately and are audited. Existing orders keep their original prices." />
      <PricingEditor />
      <Zones />
    </div>
  );
}

function PricingEditor() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'pricing'], queryFn: () => api<{ pricing: PricingConfig }>('/admin/config/pricing').then((r) => r.pricing) });
  const [p, setP] = useState<PricingConfig | null>(null);
  useEffect(() => {
    if (q.data) setP(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/admin/config/pricing', { method: 'PUT', body: p }),
    onSuccess: () => {
      toast.success('Pricing updated');
      qc.invalidateQueries({ queryKey: ['admin', 'pricing'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!p) return <Spinner />;
  const rupee = (k: keyof PricingConfig, label: string) => (
    <Field label={label}>{(id) => <Input id={id} inputMode="decimal" value={(p[k] as number | null) === null ? '' : (p[k] as number) / 100} onChange={(e) => setP({ ...p, [k]: e.target.value === '' && k === 'freeDeliveryAbove' ? null : Math.round(Number(e.target.value) * 100) })} />}</Field>
  );
  const pct = (k: 'foodGstBps' | 'feeGstBps' | 'defaultCommissionBps', label: string) => (
    <Field label={label}>{(id) => <Input id={id} inputMode="decimal" value={p[k] / 100} onChange={(e) => setP({ ...p, [k]: Math.round(Number(e.target.value) * 100) })} />}</Field>
  );
  return (
    <section className="card space-y-4 p-5">
      <h2 className="text-lg font-bold">Fees</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {rupee('platformFee', 'Platform fee (₹/order)')}
        {rupee('freeDeliveryAbove', 'Free delivery above (₹, blank = never)')}
        {rupee('smallCartThreshold', 'Small-order threshold (₹)')}
        {rupee('smallCartFee', 'Small-order fee (₹)')}
        {pct('foodGstBps', 'GST on food (%)')}
        {pct('feeGstBps', 'GST on fees (%)')}
        {pct('defaultCommissionBps', 'Default commission (%)')}
        <Field label="Max delivery distance (km)">{(id) => <Input id={id} inputMode="decimal" value={p.maxDeliveryKm} onChange={(e) => setP({ ...p, maxDeliveryKm: Number(e.target.value) })} />}</Field>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Delivery fee slabs</p>
        <div className="space-y-2">
          {p.deliverySlabs.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              up to <Input className="w-20" inputMode="decimal" value={s.uptoKm} onChange={(e) => setP({ ...p, deliverySlabs: p.deliverySlabs.map((x, j) => (j === i ? { ...x, uptoKm: Number(e.target.value) } : x)) })} aria-label="Up to km" /> km →
              ₹ <Input className="w-24" inputMode="decimal" value={s.fee / 100} onChange={(e) => setP({ ...p, deliverySlabs: p.deliverySlabs.map((x, j) => (j === i ? { ...x, fee: Math.round(Number(e.target.value) * 100) } : x)) })} aria-label="Fee in rupees" />
            </div>
          ))}
        </div>
      </div>
      <Notice>GST rates here are configuration, not tax advice. Confirm the correct treatment with your tax advisor.</Notice>
      <Button onClick={() => save.mutate()} loading={save.isPending}>
        Save fees
      </Button>
    </section>
  );
}

function Zones() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'zones'], queryFn: () => api<{ zones: { id: string; name: string; city: string; center: { lat: number; lng: number }; radiusKm: number; active: boolean }[] }>('/admin/zones').then((r) => r.zones) });
  const [f, setF] = useState({ name: '', city: 'Bengaluru', lat: '', lng: '', radiusKm: '5' });
  const add = useMutation({
    mutationFn: () => api('/admin/zones', { method: 'POST', body: { name: f.name, city: f.city, center: { lat: Number(f.lat), lng: Number(f.lng) }, radiusKm: Number(f.radiusKm) } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'zones'] });
      setF({ ...f, name: '', lat: '', lng: '' });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (z: { id: string; name: string; city: string; center: { lat: number; lng: number }; radiusKm: number; active: boolean }) => api(`/admin/zones/${z.id}`, { method: 'PUT', body: { name: z.name, city: z.city, center: z.center, radiusKm: z.radiusKm, active: !z.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'zones'] }),
  });
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">Service zones</h2>
      {q.data && (
        <Table head={['Zone', 'Centre', 'Radius', 'Active']} empty={!q.data.length}>
          {q.data.map((z) => (
            <tr key={z.id}>
              <Td>
                <p className="font-semibold">{z.name}</p>
                <p className="text-xs text-muted">{z.city}</p>
              </Td>
              <Td className="num text-xs">
                {z.center.lat.toFixed(4)}, {z.center.lng.toFixed(4)}
              </Td>
              <Td>{z.radiusKm} km</Td>
              <Td>
                <Toggle checked={z.active} onChange={() => toggle.mutate(z)} label={`${z.name} active`} />
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <div className="card grid gap-3 p-4 sm:grid-cols-6">
        <Input className="sm:col-span-2" placeholder="Zone name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Zone name" />
        <Input placeholder="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} aria-label="City" />
        <Input placeholder="Lat" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} aria-label="Centre latitude" />
        <Input placeholder="Lng" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} aria-label="Centre longitude" />
        <div className="flex gap-2">
          <Input placeholder="km" value={f.radiusKm} onChange={(e) => setF({ ...f, radiusKm: e.target.value })} aria-label="Radius km" />
          <Button onClick={() => add.mutate()} loading={add.isPending} disabled={!f.name || !f.lat || !f.lng}>
            Add
          </Button>
        </div>
      </div>
    </section>
  );
}

// ── Reviews, users, notifications, audit, payouts ────────────────────────────

export function AdminReviewsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'reviews'], queryFn: () => api<{ reviews: { id: string; restaurant: string; customerName: string; foodRating: number; comment: string; hidden: boolean; hiddenReason: string; createdAt: string }[] }>('/admin/reviews').then((r) => r.reviews) });
  return (
    <div className="space-y-5">
      <PageHeader title="Review moderation" sub="Hide reviews that are abusive, contain personal data, or are unrelated to the order. Ratings are recalculated instantly." />
      {!q.data ? (
        <Spinner />
      ) : (
        <Table head={['Restaurant', 'Review', 'Rating', 'Status', '']} empty={!q.data.length}>
          {q.data.map((r) => (
            <tr key={r.id}>
              <Td>{r.restaurant}</Td>
              <Td>
                <p>{r.comment || <span className="text-muted">(no comment)</span>}</p>
                <p className="text-xs text-muted">
                  {r.customerName} · {formatDateTime(r.createdAt)}
                </p>
              </Td>
              <Td>{r.foodRating}★</Td>
              <Td>{r.hidden ? <Badge tone="chili">hidden</Badge> : <Badge tone="leaf">visible</Badge>}</Td>
              <Td>
                <ConfirmAction
                  label={r.hidden ? 'Unhide' : 'Hide'}
                  title={r.hidden ? 'Make visible again?' : 'Hide this review?'}
                  requireNote={!r.hidden}
                  onConfirm={(reason) => api(`/admin/reviews/${r.id}`, { method: 'PATCH', body: { hidden: !r.hidden, reason } }).then(() => qc.invalidateQueries({ queryKey: ['admin', 'reviews'] }))}
                />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function AdminOpsPage() {
  const qc = useQueryClient();
  const [nStatus, setNStatus] = useState('');
  const notifications = useQuery({
    queryKey: ['admin', 'notifications', nStatus],
    queryFn: () => api<{ notifications: { id: string; event: string; to: string; body: string; status: string; provider: string; attempts: number; lastError: string; createdAt: string }[] }>(`/admin/notifications${nStatus ? `?status=${nStatus}` : ''}`).then((r) => r.notifications),
    refetchInterval: 15_000,
  });
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<{ users: { id: string; name: string; email: string; phone: string; role: string; status: string }[] }>('/admin/users').then((r) => r.users) });
  const audit = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api<{ logs: { id: string; actor: string; action: string; targetType: string; targetId: string; createdAt: string }[] }>('/admin/audit').then((r) => r.logs) });
  const payouts = useQuery({ queryKey: ['admin', 'payouts'], queryFn: () => api<{ payouts: { id: string; restaurant: string; periodStart: string; periodEnd: string; orders: number; net: number; status: string }[] }>('/admin/payouts').then((r) => r.payouts) });
  const gen = useMutation({
    mutationFn: () => {
      const end = new Date();
      end.setHours(0, 0, 0, 0);
      const start = new Date(end.getTime() - 7 * 86400_000);
      return api<{ restaurants: number; created: number }>('/admin/payouts/generate', { method: 'POST', body: { periodStart: start.toISOString(), periodEnd: end.toISOString() } });
    },
    onSuccess: (r) => {
      toast.success(`Generated ${r.created} statement(s)`);
      qc.invalidateQueries({ queryKey: ['admin', 'payouts'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-8">
      <PageHeader title="Operations" sub="Notification outbox, users, payouts and the audit trail." />
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">SMS outbox</h2>
          <Select value={nStatus} onChange={(e) => setNStatus(e.target.value)} className="h-9 w-44" aria-label="Filter notifications">
            <option value="">All</option>
            <option value="FAILED">Failed</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="SKIPPED">Skipped (opt-out)</option>
          </Select>
        </div>
        {notifications.data && (
          <Table head={['Event', 'To', 'Status', 'Message', '']} empty={!notifications.data.length}>
            {notifications.data.map((n) => (
              <tr key={n.id}>
                <Td>
                  {n.event}
                  <span className="block text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                </Td>
                <Td className="num">{n.to}</Td>
                <Td>
                  <Badge tone={n.status === 'SENT' || n.status === 'DELIVERED' ? 'leaf' : n.status === 'FAILED' || n.status === 'UNDELIVERED' ? 'chili' : 'neutral'}>{n.status.toLowerCase()}</Badge>
                  <span className="block text-xs text-muted">
                    {n.provider ?? '—'} · {n.attempts} attempt(s)
                  </span>
                  {n.lastError && <span className="block text-xs text-chili-600">{n.lastError}</span>}
                </Td>
                <Td className="max-w-sm text-xs text-muted">{n.body}</Td>
                <Td>
                  {['FAILED', 'UNDELIVERED'].includes(n.status) && (
                    <Button size="sm" variant="secondary" onClick={() => api(`/admin/notifications/${n.id}/retry`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['admin', 'notifications'] }))}>
                      Retry
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Restaurant payouts</h2>
          <Button size="sm" variant="secondary" onClick={() => gen.mutate()} loading={gen.isPending}>
            Generate last 7 days
          </Button>
        </div>
        {payouts.data && (
          <Table head={['Restaurant', 'Period', 'Orders', 'Net payable', 'Status']} empty={!payouts.data.length}>
            {payouts.data.map((p) => (
              <tr key={p.id}>
                <Td>{p.restaurant}</Td>
                <Td className="text-xs">
                  {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                </Td>
                <Td>{p.orders}</Td>
                <Td className="num font-semibold">{inr(p.net)}</Td>
                <Td>
                  {p.status === 'PAID' ? (
                    <Badge tone="leaf">paid</Badge>
                  ) : (
                    <ConfirmAction label="Mark paid" title="Mark payout as paid?" body="Do this after the bank transfer is complete." onConfirm={() => api(`/admin/payouts/${p.id}/mark-paid`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['admin', 'payouts'] }))} />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Users</h2>
        {users.data && (
          <Table head={['User', 'Role', 'Status', '']}>
            {users.data.map((u) => (
              <tr key={u.id}>
                <Td>
                  <p className="font-semibold">{u.name}</p>
                  <p className="text-xs text-muted">
                    {u.email} · {u.phone}
                  </p>
                </Td>
                <Td>{u.role}</Td>
                <Td>{u.status === 'active' ? <Badge tone="leaf">active</Badge> : <Badge tone="chili">suspended</Badge>}</Td>
                <Td>
                  {u.role !== 'admin' && (
                    <ConfirmAction
                      label={u.status === 'active' ? 'Suspend' : 'Reactivate'}
                      variant={u.status === 'active' ? 'danger' : 'success'}
                      title={`${u.status === 'active' ? 'Suspend' : 'Reactivate'} ${u.name}?`}
                      body="All of this user’s sessions are signed out."
                      requireNote={u.status === 'active'}
                      onConfirm={() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'suspended' : 'active' } }).then(() => qc.invalidateQueries({ queryKey: ['admin', 'users'] }))}
                    />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Audit log</h2>
        {audit.data && (
          <Table head={['When', 'Who', 'Action', 'Target']} empty={!audit.data.length}>
            {audit.data.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(a.createdAt)}</Td>
                <Td>{a.actor}</Td>
                <Td className="font-mono text-xs">{a.action}</Td>
                <Td className="text-xs">
                  {a.targetType} · {a.targetId.slice(-8)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
