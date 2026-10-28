import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BellRing, ChefHat, Clock, PackageCheck } from 'lucide-react';
import type { OrderStatus } from '@tadka/shared';
import { api } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import type { Order } from '../../lib/types';
import { errorMessage, formatTime, inr, relativeSeconds } from '../../lib/format';
import { Badge, Button, DietMark, EmptyState, ErrorState, Field, Modal, Notice, PageHeader, Select, Spinner, Toggle, toast } from '../../components/ui';

export interface MerchantRestaurant {
  id: string;
  name: string;
  slug: string;
  approval: string;
  isPaused: boolean;
}

export function useMyRestaurant() {
  return useQuery({
    queryKey: ['merchant', 'restaurant'],
    queryFn: () => api<{ restaurant: MerchantRestaurant }>('/merchant/restaurant').then((r) => r.restaurant),
    retry: false,
  });
}

const COLUMNS: { key: OrderStatus; title: string; icon: typeof BellRing }[] = [
  { key: 'CONFIRMED', title: 'New', icon: BellRing },
  { key: 'ACCEPTED', title: 'Accepted', icon: Clock },
  { key: 'PREPARING', title: 'Preparing', icon: ChefHat },
  { key: 'READY_FOR_PICKUP', title: 'Ready for pickup', icon: PackageCheck },
];

export function RestaurantOrdersPage() {
  const qc = useQueryClient();
  const r = useMyRestaurant();
  const [view, setView] = useState<'active' | 'history'>('active');
  const orders = useQuery({
    queryKey: ['merchant', 'orders', view],
    queryFn: () => api<{ orders: Order[] }>(`/merchant/orders?view=${view}`).then((x) => x.orders),
    enabled: r.isSuccess,
    refetchInterval: 60_000, // safety net in case a socket event is missed
  });
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const s = getSocket();
    const refresh = () => qc.invalidateQueries({ queryKey: ['merchant', 'orders'] });
    const onNew = (p: { orderNumber: string }) => {
      toast.info(`New order ${p.orderNumber}`);
      refresh();
    };
    s.on('order:new', onNew);
    s.on('order:updated', refresh);
    s.on('connect', refresh);
    return () => {
      s.off('order:new', onNew);
      s.off('order:updated', refresh);
      s.off('connect', refresh);
    };
  }, [qc]);

  const pause = useMutation({
    mutationFn: (paused: boolean) => api('/merchant/restaurant/pause', { method: 'POST', body: { paused } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merchant', 'restaurant'] }),
  });

  if (r.isError) return <Navigate to="/partner/restaurant/onboarding" replace />;
  if (!r.data) return <Spinner />;
  const newCount = orders.data?.filter((o) => o.status === 'CONFIRMED').length ?? 0;

  return (
    <div>
      <PageHeader
        title={r.data.name}
        sub={newCount ? `${newCount} new order${newCount > 1 ? 's' : ''} waiting. Customers are refunded automatically after 10 minutes without a response.` : 'Live order queue'}
        actions={
          <label className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold">
            {r.data.isPaused ? 'Paused: not taking orders' : 'Accepting orders'}
            <Toggle checked={!r.data.isPaused} onChange={(on) => pause.mutate(!on)} label="Accepting orders" />
          </label>
        }
      />
      {r.data.approval !== 'APPROVED' && (
        <div className="mb-5">
          <Notice tone="warn" title={`Verification ${r.data.approval.toLowerCase()}`}>
            Your restaurant isn’t visible to customers until our team verifies your FSSAI licence and details. You can set up your menu meanwhile.
          </Notice>
        </div>
      )}
      <div className="mb-4 inline-flex rounded-xl border border-line bg-surface p-1" role="tablist">
        {(['active', 'history'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={clsx('rounded-lg px-4 py-1.5 text-sm font-semibold capitalize', view === v ? 'bg-ink text-white' : 'text-ink-2')}>
            {v}
          </button>
        ))}
      </div>
      {orders.isError ? (
        <ErrorState error={orders.error} retry={() => orders.refetch()} />
      ) : !orders.data ? (
        <Spinner />
      ) : view === 'history' ? (
        <HistoryTable orders={orders.data} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-4">
          {COLUMNS.map((c) => {
            const list = orders.data.filter((o) => o.status === c.key);
            return (
              <section key={c.key} aria-labelledby={`col-${c.key}`} className="rounded-2xl bg-ink/[0.03] p-3">
                <h2 id={`col-${c.key}`} className="mb-3 flex items-center gap-2 px-1 text-sm font-bold">
                  <c.icon className="size-4" aria-hidden /> {c.title}
                  <span className="num ml-auto rounded-full bg-surface px-2 text-xs">{list.length}</span>
                </h2>
                <div className="space-y-3">
                  {list.map((o) => (
                    <TicketCard key={o.id} o={o} />
                  ))}
                  {list.length === 0 && <p className="px-1 py-6 text-center text-xs text-muted">Nothing here</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TicketCard({ o }: { o: Order }) {
  const qc = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('Item out of stock');
  const act = useMutation({
    mutationFn: (body: { to: OrderStatus; reason?: string }) => api(`/merchant/orders/${o.id}/status`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merchant', 'orders'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const placed = o.timeline.find((t) => t.status === 'CONFIRMED')?.at ?? o.createdAt;
  const urgent = o.status === 'CONFIRMED' && Date.now() - new Date(placed).getTime() > 5 * 60_000;
  return (
    <article className={clsx('card p-3.5', o.status === 'CONFIRMED' && 'ring-2 ring-brand-500', urgent && 'ring-chili-600')}>
      <header className="flex items-center justify-between text-xs">
        <span className="font-bold">{o.orderNumber}</span>
        <span className={clsx(urgent ? 'font-bold text-chili-600' : 'text-muted')}>{relativeSeconds(placed)}</span>
      </header>
      <p className="mt-0.5 text-xs text-muted">
        {o.customerName} · {o.dropLocality}
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {o.items.map((it, i) => (
          <li key={i} className="flex gap-1.5">
            <DietMark diet={it.diet} className="mt-0.5" />
            <span>
              <strong>{it.quantity}×</strong> {it.name}
              {it.options.length > 0 && <span className="block text-xs text-muted">{it.options.map((x) => x.name).join(', ')}</span>}
            </span>
          </li>
        ))}
      </ul>
      {o.instructions && <p className="mt-2 rounded-lg bg-turmeric-100 px-2 py-1 text-xs">“{o.instructions}”</p>}
      <p className="num mt-2 text-xs text-muted">Item total {inr(o.pricing?.itemTotal ?? 0)}</p>
      {o.delivery && o.status !== 'CONFIRMED' && (
        <p className="mt-1 text-xs">
          Rider: {o.delivery.partnerName ? <strong>{o.delivery.partnerName}</strong> : <span className="text-muted">searching…</span>}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {o.status === 'CONFIRMED' && (
          <>
            <Button size="sm" variant="success" className="flex-1" loading={act.isPending} onClick={() => act.mutate({ to: 'ACCEPTED' })}>
              Accept
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setRejectOpen(true)}>
              Reject
            </Button>
          </>
        )}
        {o.status === 'ACCEPTED' && (
          <Button size="sm" block loading={act.isPending} onClick={() => act.mutate({ to: 'PREPARING' })}>
            Start preparing
          </Button>
        )}
        {o.status === 'PREPARING' && (
          <Button size="sm" block variant="success" loading={act.isPending} onClick={() => act.mutate({ to: 'READY_FOR_PICKUP' })}>
            Mark ready
          </Button>
        )}
        {o.status === 'READY_FOR_PICKUP' && <Badge tone="leaf">Waiting for rider</Badge>}
      </div>
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`Reject ${o.orderNumber}?`}
        footer={
          <Button
            variant="danger"
            block
            loading={act.isPending}
            onClick={() => {
              act.mutate({ to: 'REJECTED', reason });
              setRejectOpen(false);
            }}
          >
            Reject and refund customer
          </Button>
        }
      >
        <Field label="Reason (shown to the customer)">
          {(id) => (
            <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option>Item out of stock</option>
              <option>Kitchen too busy right now</option>
              <option>Closing soon</option>
              <option>Unable to fulfil special instructions</option>
            </Select>
          )}
        </Field>
        <p className="mt-3 text-sm text-muted">The customer gets a full refund automatically. Frequent rejections lower your acceptance rate.</p>
      </Modal>
    </article>
  );
}

function HistoryTable({ orders }: { orders: Order[] }) {
  if (!orders.length) return <EmptyState title="No past orders yet" />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3">Order</th>
            <th className="px-4 py-3">Items</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Item total</th>
            <th className="px-4 py-3 text-right">Commission</th>
            <th className="px-4 py-3">Placed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="px-4 py-3 font-semibold">{o.orderNumber}</td>
              <td className="px-4 py-3 text-muted">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</td>
              <td className="px-4 py-3">
                <Badge tone={o.status === 'DELIVERED' ? 'leaf' : ['REJECTED', 'CANCELLED'].includes(o.status) ? 'chili' : 'brand'}>{o.statusLabel}</Badge>
              </td>
              <td className="num px-4 py-3 text-right">{inr(o.pricing?.itemTotal ?? 0)}</td>
              <td className="num px-4 py-3 text-right text-muted">{o.commission ? `${inr(o.commission.amount)} (${o.commission.bps / 100}%)` : '—'}</td>
              <td className="px-4 py-3 text-muted">{formatTime(o.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
