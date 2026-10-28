import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_STATUSES, STATUS_LABELS, type OrderStatus } from '@tadka/shared';
import { api } from '../../lib/api';
import type { Order } from '../../lib/types';
import { errorMessage, formatDateTime, inr } from '../../lib/format';
import { Badge, Button, EmptyState, ErrorState, Field, Input, Modal, Notice, PageHeader, Select, Spinner, Stat, Textarea, toast } from '../../components/ui';
import { OrderTimeline } from '../../components/OrderTimeline';
import { PriceBreakdown } from '../../components/PriceBreakdown';
import { statusTone } from '../customer/Orders';

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  if (empty) return <EmptyState title="Nothing to show" />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children: ReactNode; className?: string }) => <td className={`px-4 py-3 align-top ${className ?? ''}`}>{children}</td>;

/** Confirmation with a mandatory note: sensitive admin actions are audited with their reason. */
export function ConfirmAction({ label, title, body, onConfirm, variant = 'secondary', requireNote }: { label: string; title: string; body?: string; onConfirm: (note: string) => Promise<unknown>; variant?: 'secondary' | 'danger' | 'success'; requireNote?: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <Button
            block
            variant={variant === 'secondary' ? 'primary' : variant}
            loading={busy}
            disabled={requireNote && note.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(note);
                setOpen(false);
                setNote('');
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm
          </Button>
        }
      >
        {body && <p className="mb-3 text-sm text-ink-2">{body}</p>}
        <Field label={requireNote ? 'Reason (recorded in the audit log)' : 'Note (optional, audit log)'}>{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />}</Field>
      </Modal>
    </>
  );
}

interface Metrics {
  ordersByStatus: Record<string, number>;
  gmvDelivered: number;
  ordersLast24h: number;
  avgAcceptSeconds: number | null;
  avgDeliveryMinutes: number | null;
  etaOnTimeRate: number | null;
  failedPaymentRate: number | null;
  failedNotifications: number;
  openRefunds: number;
  pendingApprovals: { restaurants: number; partners: number };
}

export function AdminOverviewPage() {
  const q = useQuery({ queryKey: ['admin', 'metrics'], queryFn: () => api<Metrics>('/admin/metrics'), refetchInterval: 30_000 });
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const m = q.data;
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
  return (
    <div className="space-y-6">
      <PageHeader title="Operations overview" sub="Last 7 days unless noted. Refreshes every 30 s." />
      {(m.pendingApprovals.restaurants > 0 || m.pendingApprovals.partners > 0 || m.openRefunds > 0 || m.failedNotifications > 0) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {m.pendingApprovals.restaurants > 0 && <ActionTile to="/admin/supply" text={`${m.pendingApprovals.restaurants} restaurant(s) awaiting verification`} />}
          {m.pendingApprovals.partners > 0 && <ActionTile to="/admin/supply?tab=partners" text={`${m.pendingApprovals.partners} partner(s) awaiting approval`} />}
          {m.openRefunds > 0 && <ActionTile to="/admin/refunds" text={`${m.openRefunds} refund(s) need a decision`} />}
          {m.failedNotifications > 0 && <ActionTile to="/admin/ops" text={`${m.failedNotifications} SMS failed to deliver`} />}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Paid orders (24h)" value={m.ordersLast24h} />
        <Stat label="Delivered GMV" value={inr(m.gmvDelivered, true)} />
        <Stat label="ETA within range" value={pct(m.etaOnTimeRate)} sub="Delivered before the upper bound of the first promised range" />
        <Stat label="Failed payment rate" value={pct(m.failedPaymentRate)} />
        <Stat label="Avg. restaurant response" value={m.avgAcceptSeconds === null ? '—' : `${Math.round(m.avgAcceptSeconds / 6) / 10} min`} />
        <Stat label="Avg. order → door" value={m.avgDeliveryMinutes === null ? '—' : `${m.avgDeliveryMinutes} min`} />
        <Stat label="Open refunds" value={m.openRefunds} />
        <Stat label="Failed SMS" value={m.failedNotifications} />
      </div>
      <section className="card p-5">
        <h2 className="mb-3 text-lg font-bold">Orders by status</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(m.ordersByStatus).map(([s, n]) => (
            <Link key={s} to={`/admin/orders?status=${s}`}>
              <Badge tone={statusTone(s as OrderStatus)} className="px-3 py-1 text-sm">
                {STATUS_LABELS[s as OrderStatus]} · {n}
              </Badge>
            </Link>
          ))}
          {Object.keys(m.ordersByStatus).length === 0 && <p className="text-sm text-muted">No orders yet.</p>}
        </div>
      </section>
    </div>
  );
}

function ActionTile({ to, text }: { to: string; text: string }) {
  return (
    <Link to={to} className="rounded-2xl border border-turmeric-400 bg-turmeric-100 p-4 text-sm font-semibold hover:brightness-95">
      {text} →
    </Link>
  );
}

// ── Supply: restaurants & partners ───────────────────────────────────────────

export function AdminSupplyPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'partners' ? 'partners' : 'restaurants';
  return (
    <div className="space-y-5">
      <PageHeader title="Supply" sub="Only approved restaurants are visible to customers. Approved partners can go online." />
      <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist">
        {(['restaurants', 'partners'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setParams({ tab: t })} className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize ${tab === t ? 'bg-ink text-white' : 'text-ink-2'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'restaurants' ? <RestaurantsTable /> : <PartnersTable />}
    </div>
  );
}

const approvalTone = (a: string) => (a === 'APPROVED' ? 'leaf' : a === 'PENDING' ? 'turmeric' : 'chili') as 'leaf' | 'turmeric' | 'chili';

function RestaurantsTable() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'restaurants'],
    queryFn: () => api<{ restaurants: { id: string; name: string; slug: string; cuisines: string[]; locality: string; fssaiLicense: string; approval: string; sponsored: boolean; commissionBps: number | null; rating: { avg: number; count: number }; demo: boolean }[] }>('/admin/restaurants').then((r) => r.restaurants),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'restaurants'] });
  const setApproval = (id: string, approval: string) => (note: string) => api(`/admin/restaurants/${id}/approval`, { method: 'POST', body: { approval, note } }).then(refresh);
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => api(`/admin/restaurants/${id}`, { method: 'PATCH', body }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  if (!q.data) return <Spinner />;
  return (
    <Table head={['Restaurant', 'FSSAI', 'Status', 'Commission', 'Sponsored', 'Actions']} empty={!q.data.length}>
      {q.data.map((r) => (
        <tr key={r.id}>
          <Td>
            <p className="font-semibold">
              {r.name} {r.demo && <Badge tone="turmeric">demo</Badge>}
            </p>
            <p className="text-xs text-muted">
              {r.cuisines.join(', ')} · {r.locality}
            </p>
          </Td>
          <Td className="num">{r.fssaiLicense}</Td>
          <Td>
            <Badge tone={approvalTone(r.approval)}>{r.approval.toLowerCase()}</Badge>
          </Td>
          <Td>
            <Select
              className="h-9 w-28"
              value={r.commissionBps ?? ''}
              onChange={(e) => patch.mutate({ id: r.id, body: { commissionBps: e.target.value === '' ? null : Number(e.target.value) } })}
              aria-label={`Commission for ${r.name}`}
            >
              <option value="">Default</option>
              {[1000, 1200, 1500, 1800, 2000, 2200].map((b) => (
                <option key={b} value={b}>
                  {b / 100}%
                </option>
              ))}
            </Select>
          </Td>
          <Td>
            <input type="checkbox" checked={r.sponsored} onChange={(e) => patch.mutate({ id: r.id, body: { sponsored: e.target.checked } })} aria-label={`Sponsored placement for ${r.name}`} className="size-4 accent-[var(--color-brand-500)]" />
          </Td>
          <Td>
            <div className="flex flex-wrap gap-1.5">
              {r.approval !== 'APPROVED' && <ConfirmAction label="Approve" variant="success" title={`Approve ${r.name}?`} body="Confirm you have verified the FSSAI licence and address." onConfirm={setApproval(r.id, 'APPROVED')} />}
              {r.approval === 'PENDING' && <ConfirmAction label="Reject" title={`Reject ${r.name}?`} requireNote onConfirm={setApproval(r.id, 'REJECTED')} />}
              {r.approval === 'APPROVED' && <ConfirmAction label="Suspend" variant="danger" title={`Suspend ${r.name}?`} body="The restaurant disappears from discovery immediately." requireNote onConfirm={setApproval(r.id, 'SUSPENDED')} />}
            </div>
          </Td>
        </tr>
      ))}
    </Table>
  );
}

function PartnersTable() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'partners'],
    queryFn: () => api<{ partners: { userId: string; name: string; email: string; phone: string; vehicle: string; vehicleNumber: string; approval: string; online: boolean; busy: boolean }[] }>('/admin/partners').then((r) => r.partners),
  });
  const setApproval = (id: string, approval: string) => (note: string) => api(`/admin/partners/${id}/approval`, { method: 'POST', body: { approval, note } }).then(() => qc.invalidateQueries({ queryKey: ['admin', 'partners'] }));
  if (!q.data) return <Spinner />;
  return (
    <Table head={['Partner', 'Vehicle', 'Status', 'Now', 'Actions']} empty={!q.data.length}>
      {q.data.map((p) => (
        <tr key={p.userId}>
          <Td>
            <p className="font-semibold">{p.name}</p>
            <p className="text-xs text-muted">
              {p.email} · {p.phone}
            </p>
          </Td>
          <Td>
            {p.vehicle.replace('_', ' ')} <span className="text-xs text-muted">{p.vehicleNumber}</span>
          </Td>
          <Td>
            <Badge tone={approvalTone(p.approval)}>{p.approval.toLowerCase()}</Badge>
          </Td>
          <Td>{p.busy ? <Badge tone="brand">on delivery</Badge> : p.online ? <Badge tone="leaf">online</Badge> : <span className="text-xs text-muted">offline</span>}</Td>
          <Td>
            <div className="flex gap-1.5">
              {p.approval !== 'APPROVED' && <ConfirmAction label="Approve" variant="success" title={`Approve ${p.name}?`} body="Confirm ID and vehicle documents were verified." onConfirm={setApproval(p.userId, 'APPROVED')} />}
              {p.approval === 'APPROVED' && <ConfirmAction label="Suspend" variant="danger" title={`Suspend ${p.name}?`} requireNote onConfirm={setApproval(p.userId, 'SUSPENDED')} />}
            </div>
          </Td>
        </tr>
      ))}
    </Table>
  );
}

// ── Orders ───────────────────────────────────────────────────────────────────

export function AdminOrdersPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useQuery({
    queryKey: ['admin', 'orders', status, search],
    queryFn: () =>
      api<{ orders: { id: string; orderNumber: string; status: OrderStatus; restaurant: string; customer: string; total: number; refundStatus: string; supportStatus: string; createdAt: string }[] }>(
        `/admin/orders?${new URLSearchParams({ ...(status && { status }), ...(search && { q: search }) })}`,
      ).then((r) => r.orders),
    refetchInterval: 20_000,
  });
  return (
    <div className="space-y-5">
      <PageHeader title="Orders" />
      <div className="flex flex-wrap gap-2">
        <Select value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})} className="h-10 w-56" aria-label="Filter by status">
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order number, e.g. TDK-…" className="h-10 w-64" aria-label="Search by order number" />
      </div>
      {q.isError ? (
        <ErrorState error={q.error} />
      ) : !q.data ? (
        <Spinner />
      ) : (
        <Table head={['Order', 'Restaurant', 'Customer', 'Status', 'Total', 'Placed']} empty={!q.data.length}>
          {q.data.map((o) => (
            <tr key={o.id} className="hover:bg-paper">
              <Td>
                <Link to={`/admin/orders/${o.id}`} className="font-semibold text-brand-700 hover:underline">
                  {o.orderNumber}
                </Link>
                {o.supportStatus === 'OPEN' && <Badge tone="chili" className="ml-1.5">support</Badge>}
              </Td>
              <Td>{o.restaurant}</Td>
              <Td>{o.customer}</Td>
              <Td>
                <Badge tone={statusTone(o.status)}>{STATUS_LABELS[o.status]}</Badge>
                {o.refundStatus !== 'NONE' && <span className="block text-xs text-muted">refund {o.refundStatus.toLowerCase()}</span>}
              </Td>
              <Td className="num">{inr(o.total)}</Td>
              <Td className="whitespace-nowrap text-muted">{formatDateTime(o.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

interface AdminOrderDetail {
  order: Order & { customerName: string; assignment: { status: string; partnerId: string | null; history: { status: string; at: string; note?: string }[] } | null };
  payments: { id: string; attempt: number; provider: string; status: string; amount: number; refundedAmount: number; failureReason: string; events: { type: string; at: string; eventId: string }[] }[];
  refunds: { id: string; amount: number; status: string; kind: string; reason: string; failureReason: string; createdAt: string }[];
  notifications: { id: string; event: string; status: string; to: string; body: string; attempts: number; lastError: string; createdAt: string }[];
  audit: { _id: string; action: string; actorRole: string; changes: unknown; createdAt: string }[];
}

export function AdminOrderDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'order', id], queryFn: () => api<AdminOrderDetail>(`/admin/orders/${id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'order', id] });
  if (q.isError) return <ErrorState error={q.error} />;
  if (!q.data) return <Spinner />;
  const { order: o, payments, refunds, notifications, audit } = q.data;
  const canCancel = ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'].includes(o.status);
  const canReassign = o.assignment && ['OFFERED', 'ACCEPTED'].includes(o.assignment.status);
  return (
    <div className="space-y-5">
      <PageHeader
        title={o.orderNumber}
        sub={`${o.restaurant.name} → ${o.customerName} · ${formatDateTime(o.createdAt)}`}
        actions={
          <>
            {canReassign && <ConfirmAction label="Reassign rider" title="Reassign delivery?" body="The current partner is released and the order goes back to dispatch." onConfirm={(note) => api(`/admin/orders/${id}/reassign`, { method: 'POST', body: { note: note || 'Reassigned by admin' } }).then(refresh)} />}
            {canCancel && <ConfirmAction label="Cancel order" variant="danger" requireNote title="Cancel and refund?" body="Paid orders are refunded in full automatically." onConfirm={(reason) => api(`/admin/orders/${id}/cancel`, { method: 'POST', body: { reason } }).then(refresh)} />}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card p-5">
          <h2 className="mb-3 font-bold">Timeline</h2>
          <Badge tone={statusTone(o.status)}>{o.statusLabel}</Badge>
          <div className="mt-4">
            <OrderTimeline status={o.status} timeline={o.timeline} />
          </div>
          {o.promisedEta && (
            <p className="mt-4 text-xs text-muted">
              Promised at confirmation: {o.promisedEta.minMinutes}–{o.promisedEta.maxMinutes} min
            </p>
          )}
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-bold">Bill</h2>
          {o.pricing && <PriceBreakdown quote={o.pricing} compact />}
          {o.commission && (
            <p className="mt-3 text-xs text-muted">
              Commission {o.commission.bps / 100}% = {inr(o.commission.amount)} + GST {inr(o.commission.gst)}
            </p>
          )}
        </section>
        <section className="card p-5 text-sm">
          <h2 className="mb-3 font-bold">Delivery</h2>
          {o.assignment ? (
            <>
              <p>
                Status: <Badge>{o.assignment.status.toLowerCase()}</Badge>
              </p>
              <ol className="mt-3 space-y-1 text-xs text-muted">
                {o.assignment.history.map((h, i) => (
                  <li key={i}>
                    {formatDateTime(h.at)} · {h.status}
                    {h.note ? ` · ${h.note}` : ''}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-muted">No assignment yet.</p>
          )}
        </section>
      </div>
      <section>
        <h2 className="mb-2 font-bold">Payments</h2>
        <Table head={['Attempt', 'Provider', 'Status', 'Amount', 'Refunded', 'Events']} empty={!payments.length}>
          {payments.map((p) => (
            <tr key={p.id}>
              <Td>#{p.attempt}</Td>
              <Td>{p.provider}</Td>
              <Td>
                {p.status}
                {p.failureReason && <span className="block text-xs text-chili-600">{p.failureReason}</span>}
              </Td>
              <Td className="num">{inr(p.amount)}</Td>
              <Td className="num">{inr(p.refundedAmount)}</Td>
              <Td className="text-xs text-muted">{p.events.map((e) => e.type).join(' → ') || '—'}</Td>
            </tr>
          ))}
        </Table>
      </section>
      {refunds.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">Refunds</h2>
          <Table head={['Amount', 'Kind', 'Reason', 'Status', 'Created']}>
            {refunds.map((r) => (
              <tr key={r.id}>
                <Td className="num">{inr(r.amount)}</Td>
                <Td>{r.kind}</Td>
                <Td>{r.reason}</Td>
                <Td>
                  {r.status}
                  {r.failureReason && <span className="block text-xs text-chili-600">{r.failureReason}</span>}
                </Td>
                <Td className="text-muted">{formatDateTime(r.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        </section>
      )}
      <section>
        <h2 className="mb-2 font-bold">Notifications</h2>
        <Table head={['Event', 'To', 'Status', 'Attempts', 'Message']} empty={!notifications.length}>
          {notifications.map((n) => (
            <tr key={n.id}>
              <Td>{n.event}</Td>
              <Td className="num">{n.to}</Td>
              <Td>
                {n.status}
                {n.lastError && <span className="block text-xs text-chili-600">{n.lastError}</span>}
              </Td>
              <Td>{n.attempts}</Td>
              <Td className="text-xs text-muted">{n.body}</Td>
            </tr>
          ))}
        </Table>
      </section>
      {audit.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">Admin actions</h2>
          <ul className="card divide-y divide-line text-sm">
            {audit.map((a) => (
              <li key={a._id} className="px-4 py-2">
                {formatDateTime(a.createdAt)} · <strong>{a.action}</strong> <span className="text-xs text-muted">{JSON.stringify(a.changes)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ── Refunds ──────────────────────────────────────────────────────────────────

export function AdminRefundsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('REQUESTED');
  const q = useQuery({
    queryKey: ['admin', 'refunds', status],
    queryFn: () => api<{ refunds: { id: string; orderId: string; orderNumber: string; orderTotal: number; amount: number; status: string; kind: string; reason: string; details: string; failureReason: string; createdAt: string }[] }>(`/admin/refunds${status ? `?status=${status}` : ''}`).then((r) => r.refunds),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'refunds'] });
  return (
    <div className="space-y-5">
      <PageHeader title="Refunds" sub="Customer requests need a decision. Automatic refunds (rejections, cancellations) appear here if they fail." />
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-56" aria-label="Filter refunds">
        <option value="REQUESTED">Needs decision</option>
        <option value="FAILED">Failed</option>
        <option value="PROCESSING">Processing</option>
        <option value="SUCCEEDED">Succeeded</option>
        <option value="REJECTED">Rejected</option>
        <option value="">All</option>
      </Select>
      {!q.data ? (
        <Spinner />
      ) : (
        <Table head={['Order', 'Reason', 'Requested', 'Status', 'Actions']} empty={!q.data.length}>
          {q.data.map((r) => (
            <tr key={r.id}>
              <Td>
                <Link to={`/admin/orders/${r.orderId}`} className="font-semibold text-brand-700 hover:underline">
                  {r.orderNumber}
                </Link>
                <span className="block text-xs text-muted">total {inr(r.orderTotal)}</span>
              </Td>
              <Td>
                <p className="font-medium">{r.reason.replace(/_/g, ' ')}</p>
                {r.details && <p className="max-w-xs text-xs text-muted">{r.details}</p>}
              </Td>
              <Td className="num">{inr(r.amount)}</Td>
              <Td>
                {r.status.toLowerCase()}
                {r.failureReason && <span className="block text-xs text-chili-600">{r.failureReason}</span>}
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1.5">
                  {r.status === 'REQUESTED' && <ApproveRefund refund={r} onDone={refresh} />}
                  {r.status === 'REQUESTED' && <ConfirmAction label="Reject" title="Reject refund request?" requireNote body="The customer sees your note." onConfirm={(note) => api(`/admin/refunds/${r.id}/reject`, { method: 'POST', body: { note } }).then(refresh)} />}
                  {r.status === 'FAILED' && <ConfirmAction label="Retry" title="Retry this refund?" onConfirm={(note) => api(`/admin/refunds/${r.id}/retry`, { method: 'POST', body: { note } }).then(refresh)} />}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function ApproveRefund({ refund, onDone }: { refund: { id: string; amount: number }; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(refund.amount / 100));
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/admin/refunds/${refund.id}/approve`, { method: 'POST', body: { amount: Math.round(Number(amount) * 100), note } }),
    onSuccess: () => {
      setOpen(false);
      onDone();
      toast.success('Refund issued');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Button size="sm" variant="success" onClick={() => setOpen(true)}>
        Approve
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Approve refund" footer={<Button block loading={m.isPending} onClick={() => m.mutate()}>Issue refund</Button>}>
        <div className="space-y-3">
          <Field label="Amount (₹)" hint="Capped automatically at what remains refundable">{(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Note to customer (optional)">{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <Notice>This calls the payment provider immediately and is recorded in the audit log.</Notice>
        </div>
      </Modal>
    </>
  );
}
