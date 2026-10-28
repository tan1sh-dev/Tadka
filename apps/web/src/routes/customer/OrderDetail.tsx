import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Bike, CircleHelp, FlaskConical, KeyRound, Loader2, RefreshCw, Star } from 'lucide-react';
import { api } from '../../lib/api';
import { getSocket, useSocketStatus } from '../../lib/socket';
import type { Eta, LiveLocation, Order } from '../../lib/types';
import { arrivalWindow, errorMessage, formatDateTime, inr, relativeSeconds } from '../../lib/format';
import { Badge, Button, DietMark, ErrorState, Field, Modal, Notice, Select, Spinner, Textarea, toast } from '../../components/ui';
import { OrderTimeline } from '../../components/OrderTimeline';
import { PriceBreakdown } from '../../components/PriceBreakdown';
import { TrackingMap } from '../../components/TrackingMap';
import { statusTone } from './Orders';

const STALE_MS = 45_000;
const TRACKABLE = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY'];

/** Live order view: subscribes to the order room and refetches on every server change signal. */
function useLiveOrder(id: string) {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const returning = params.get('payment') === 'return';
  const q = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<{ order: Order }>(`/orders/${id}`).then((r) => r.order),
    // While waiting for the payment webhook, poll as a fallback to the socket.
    refetchInterval: (query) => (query.state.data?.status === 'PAYMENT_PENDING' && returning ? 2500 : false),
  });
  const [live, setLive] = useState<(LiveLocation & { eta?: Eta | null }) | null>(null);
  const connected = useSocketStatus();

  useEffect(() => {
    const s = getSocket();
    const subscribe = () => s.emit('order:subscribe', { orderId: id });
    const onUpdate = (p: { orderId: string }) => p.orderId === id && qc.invalidateQueries({ queryKey: ['order', id] });
    const onLocation = (p: LiveLocation & { orderId: string; eta?: Eta | null }) => p.orderId === id && setLive(p);
    const onConnect = () => {
      subscribe();
      qc.invalidateQueries({ queryKey: ['order', id] }); // fill any gap while disconnected
    };
    if (s.connected) subscribe();
    s.on('connect', onConnect);
    s.on('order:updated', onUpdate);
    s.on('order:location', onLocation);
    return () => {
      s.emit('order:unsubscribe', { orderId: id });
      s.off('connect', onConnect);
      s.off('order:updated', onUpdate);
      s.off('order:location', onLocation);
    };
  }, [id, qc]);

  return { q, live, connected, returning };
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { q, live, connected, returning } = useLiveOrder(id);
  const qc = useQueryClient();
  const now = useNow();
  const [cancelOpen, setCancelOpen] = useState(false);

  const retry = useMutation({
    mutationFn: () => api<{ payment: { checkoutUrl: string } }>(`/orders/${id}/payment/retry`, { method: 'POST' }),
    onSuccess: (r) => {
      const url = r.payment.checkoutUrl;
      if (url.startsWith(window.location.origin)) window.location.assign(url.slice(window.location.origin.length));
      else window.location.assign(url);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api(`/orders/${id}/cancel`, { method: 'POST', body: { reason: 'Cancelled by customer' } }),
    onSuccess: () => {
      setCancelOpen(false);
      qc.invalidateQueries({ queryKey: ['order', id] });
      toast.success('Order cancelled');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Spinner label="Loading your order" />;
  const o = q.data;

  const loc = live ?? o.delivery?.lastLocation ?? null;
  const locAge = loc ? now - new Date(loc.at).getTime() : null;
  const stale = locAge !== null && locAge > STALE_MS;
  const eta = live?.eta ?? o.eta;
  const tracking = TRACKABLE.includes(o.status);
  const cancellable = ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFIRMED'].includes(o.status);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            {o.orderNumber} · {formatDateTime(o.createdAt)}
          </p>
          <h1 className="text-2xl font-extrabold sm:text-3xl">{o.restaurant.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {!connected && <Badge tone="chili">Reconnecting…</Badge>}
          <Badge tone={statusTone(o.status)} className="px-3 py-1 text-sm">
            {o.statusLabel}
          </Badge>
        </div>
      </div>

      {/* Payment states */}
      {o.status === 'PAYMENT_PENDING' && (
        <Notice tone="info" title={returning ? 'Confirming your payment…' : 'Awaiting payment'}>
          <span className="flex items-center gap-2">
            {returning && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {returning
              ? 'We’re waiting for the payment provider to confirm. This usually takes a few seconds. Please don’t pay again.'
              : 'This order isn’t paid yet. Complete payment to send it to the restaurant.'}
          </span>
          {!returning && (
            <Button size="sm" className="mt-2" onClick={() => retry.mutate()} loading={retry.isPending}>
              Continue to payment
            </Button>
          )}
        </Notice>
      )}
      {o.status === 'PAYMENT_FAILED' && (
        <Notice tone="error" title="Payment didn’t go through">
          No money was taken. {o.timeline.at(-1)?.note}
          <div className="mt-2">
            <Button size="sm" onClick={() => retry.mutate()} loading={retry.isPending}>
              <RefreshCw className="size-3.5" /> Retry payment
            </Button>
          </div>
        </Notice>
      )}
      {['CANCELLED', 'REJECTED'].includes(o.status) && (
        <Notice tone="error" title={o.status === 'REJECTED' ? 'The restaurant couldn’t take this order' : 'Order cancelled'}>
          {o.cancelReason}
          {o.refundStatus !== 'NONE' && (
            <span className="block">
              Refund: <strong>{o.refundStatus.toLowerCase()}</strong> {o.refundedAmount > 0 && <span className="num">({inr(o.refundedAmount)})</span>}. Refunds usually reach your account in 5–7 working days.
            </span>
          )}
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          {/* Explained ETA */}
          {eta && tracking && (
            <section className="card p-5" aria-live="polite">
              <p className="label">Estimated arrival</p>
              <p className="num mt-1 font-display text-3xl font-extrabold">{arrivalWindow(eta.minMinutes, eta.maxMinutes, eta.computedAt ? new Date(eta.computedAt).getTime() : Date.now())}</p>
              <p className="mt-1 text-sm text-muted">
                {eta.minMinutes}–{eta.maxMinutes} min from the last update · {eta.basis}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={eta.confidence === 'high' ? 'leaf' : eta.confidence === 'medium' ? 'turmeric' : 'neutral'}>{eta.confidence ?? 'low'} confidence</Badge>
                {eta.reason && (
                  <span className="text-muted">
                    Updated because: <strong className="text-ink-2">{eta.reason}</strong>
                    {eta.computedAt && ` · ${relativeSeconds(eta.computedAt, now)}`}
                  </span>
                )}
              </div>
            </section>
          )}

          {/* Tracking */}
          {tracking && o.deliveryAddress && (
            <section className="card space-y-3 p-4">
              <TrackingMap restaurant={o.restaurant.location} destination={o.deliveryAddress.location} partner={loc} stale={stale} />
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="inline-flex items-center gap-2">
                  <Bike className="size-4 text-leaf-700" aria-hidden />
                  {o.delivery?.partnerName ? (
                    <>
                      <strong>{o.delivery.partnerName}</strong> is your delivery partner
                    </>
                  ) : o.delivery?.status === 'SEARCHING' || o.delivery?.status === 'OFFERED' ? (
                    'Finding a delivery partner near the restaurant…'
                  ) : (
                    'A partner will be assigned once the restaurant accepts'
                  )}
                </span>
                {loc && (
                  <span className={clsx('text-xs', stale ? 'font-semibold text-chili-600' : 'text-muted')}>
                    Location updated {relativeSeconds(loc.at, now)}
                  </span>
                )}
              </div>
              {loc?.source === 'demo' && (
                <p className="inline-flex items-center gap-1.5 rounded-lg bg-turmeric-100 px-2 py-1 text-xs font-semibold text-turmeric-600">
                  <FlaskConical className="size-3.5" aria-hidden /> Demo mode: this route is simulated, not real GPS
                </p>
              )}
              {stale && (
                <Notice tone="warn">
                  <span className="inline-flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    The partner’s location hasn’t updated recently. They may be in a low-signal area; the time range above accounts for it.
                  </span>
                </Notice>
              )}
              {!loc && o.delivery?.partnerName && <p className="text-xs text-muted">Live location appears once the partner starts sharing it.</p>}
            </section>
          )}

          {o.deliveryOtp && ['PICKED_UP', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'PREPARING', 'ACCEPTED', 'CONFIRMED'].includes(o.status) && (
            <section className="card flex items-center gap-4 p-5">
              <span className="grid size-12 place-items-center rounded-2xl bg-ink text-white">
                <KeyRound className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm text-muted">Delivery OTP: share only when you receive your order</p>
                <p className="num font-display text-3xl font-extrabold tracking-[0.3em]">{o.deliveryOtp}</p>
              </div>
            </section>
          )}

          {o.status === 'DELIVERED' && <AfterDelivery order={o} />}

          <section className="card p-5">
            <h2 className="mb-4 text-lg font-bold">Order status</h2>
            <OrderTimeline status={o.status} timeline={o.timeline} />
          </section>
        </div>

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="mb-3 text-lg font-bold">Items</h2>
            <ul className="space-y-2 text-sm">
              {o.items.map((it, i) => (
                <li key={i} className="flex gap-2">
                  <DietMark diet={it.diet} className="mt-0.5" />
                  <span className="flex-1">
                    {it.quantity} × {it.name}
                    {it.options.length > 0 && <span className="block text-xs text-muted">{it.options.map((x) => x.name).join(', ')}</span>}
                  </span>
                  <span className="num">{inr(it.lineTotal)}</span>
                </li>
              ))}
            </ul>
            {o.pricing && (
              <div className="mt-4 border-t border-line pt-4">
                <PriceBreakdown quote={o.pricing} compact />
              </div>
            )}
          </section>
          {o.deliveryAddress && (
            <section className="card p-5 text-sm">
              <h2 className="mb-1 font-bold">Delivering to</h2>
              <p className="text-muted">
                {o.deliveryAddress.line1}, {o.deliveryAddress.locality}
                {o.deliveryAddress.landmark ? ` (${o.deliveryAddress.landmark})` : ''}, {o.deliveryAddress.city} {o.deliveryAddress.pincode}
              </p>
            </section>
          )}
          <section className="card space-y-2 p-5 text-sm">
            <h2 className="font-bold">Need help?</h2>
            <Link to={`/support?order=${o.orderNumber}`} className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline">
              <CircleHelp className="size-4" aria-hidden /> Contact support about this order
            </Link>
            {cancellable && (
              <div>
                <Button variant="secondary" size="sm" onClick={() => setCancelOpen(true)}>
                  Cancel order
                </Button>
                <p className="mt-1 text-xs text-muted">Free cancellation until the restaurant accepts. Paid orders are refunded in full.</p>
              </div>
            )}
          </section>
        </aside>
      </div>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this order?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Keep order
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel order
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-2">{o.status === 'CONFIRMED' ? `You’ll get a full refund of ${inr(o.pricing?.total ?? 0)} to your original payment method.` : 'No payment has been taken for this order.'}</p>
      </Modal>
    </div>
  );
}

function AfterDelivery({ order }: { order: Order }) {
  const qc = useQueryClient();
  const [rating, setRating] = useState(0);
  const [deliveryRating, setDeliveryRating] = useState(0);
  const [comment, setComment] = useState('');
  const [issueOpen, setIssueOpen] = useState(false);
  const refunds = useQuery({ queryKey: ['refunds', order.id], queryFn: () => api<{ refunds: { id: string; amount: number; status: string; reason: string; createdAt: string; decisionNote: string }[] }>(`/orders/${order.id}/refunds`).then((r) => r.refunds) });
  const review = useMutation({
    mutationFn: () => api(`/orders/${order.id}/review`, { method: 'POST', body: { foodRating: rating, deliveryRating: deliveryRating || undefined, comment } }),
    onSuccess: () => {
      toast.success('Thanks for the review!');
      qc.invalidateQueries({ queryKey: ['order', order.id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      {!order.reviewed && (
        <section className="card p-5">
          <h2 className="text-lg font-bold">How was it?</h2>
          <div className="mt-3 space-y-3">
            <StarPicker label="Food" value={rating} onChange={setRating} />
            <StarPicker label="Delivery" value={deliveryRating} onChange={setDeliveryRating} />
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything others should know? (optional)" maxLength={500} aria-label="Review comment" />
            <Button disabled={!rating} loading={review.isPending} onClick={() => review.mutate()}>
              Submit review
            </Button>
          </div>
        </section>
      )}
      <section className="card p-5 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Problem with your order?</h2>
          <Button variant="secondary" size="sm" onClick={() => setIssueOpen(true)}>
            Report an issue
          </Button>
        </div>
        {(refunds.data?.length ?? 0) > 0 && (
          <ul className="mt-3 space-y-2">
            {refunds.data!.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-xl bg-paper px-3 py-2">
                <span>
                  Refund <span className="num font-semibold">{inr(r.amount)}</span> · {r.reason.replace('_', ' ')}
                  {r.decisionNote && <span className="block text-xs text-muted">{r.decisionNote}</span>}
                </span>
                <Badge tone={r.status === 'SUCCEEDED' ? 'leaf' : r.status === 'REJECTED' || r.status === 'FAILED' ? 'chili' : 'turmeric'}>{r.status.toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
      <IssueModal open={issueOpen} onClose={() => setIssueOpen(false)} order={order} onDone={() => refunds.refetch()} />
    </>
  );
}

function StarPicker({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <fieldset className="flex items-center gap-3">
      <legend className="sr-only">{label} rating</legend>
      <span className="w-20 text-sm font-medium">{label}</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-pressed={value >= n}>
          <Star className={clsx('size-7', value >= n ? 'fill-turmeric-400 text-turmeric-400' : 'text-line-strong')} />
        </button>
      ))}
    </fieldset>
  );
}

function IssueModal({ open, onClose, order, onDone }: { open: boolean; onClose: () => void; order: Order; onDone: () => void }) {
  const [reason, setReason] = useState('missing_items');
  const [details, setDetails] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/orders/${order.id}/refund-requests`, { method: 'POST', body: { reason, details } }),
    onSuccess: () => {
      toast.success('We’ve got it. Our team will review your request.');
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report an issue"
      footer={
        <Button block disabled={details.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()}>
          Submit request
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="What went wrong?">
          {(id) => (
            <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="missing_items">Items missing</option>
              <option value="wrong_items">Wrong items</option>
              <option value="quality">Food quality</option>
              <option value="late">Very late</option>
              <option value="not_delivered">Not delivered</option>
              <option value="other">Something else</option>
            </Select>
          )}
        </Field>
        <Field label="Details" hint="Which items, and what happened. At least 5 characters.">
          {(id, d) => <Textarea id={id} aria-describedby={d} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={500} />}
        </Field>
        <p className="text-xs text-muted">A support agent reviews every request and you’ll see the decision here. Approved refunds go back to your original payment method.</p>
      </div>
    </Modal>
  );
}
