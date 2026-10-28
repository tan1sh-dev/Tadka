import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { FlaskConical, MapPinned, Navigation, Phone, Power, Radio, Store, User } from 'lucide-react';
import { api } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { navigationUrl } from '../../lib/maps';
import type { LatLng, Order } from '../../lib/types';
import { errorMessage, inr, relativeSeconds } from '../../lib/format';
import { Badge, Button, EmptyState, ErrorState, Input, Notice, PageHeader, Spinner, Toggle, toast } from '../../components/ui';
import { OrderTimeline } from '../../components/OrderTimeline';

interface Offer {
  orderId: string;
  expiresAt: string;
  restaurant: string;
  pickupLocality: string;
  dropLocality: string;
  distanceKm: number;
  estimatedEarnings: number;
  items: number;
}
interface MeResponse {
  profile: { approval: string; online: boolean; vehicle: string; vehicleNumber: string };
  offers: Offer[];
  active: (Order & { customerPhone?: string; restaurantPhone?: string }) | null;
  demoLocationAllowed: boolean;
}

function currentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('This browser cannot share location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Location permission denied. Enable it in your browser settings to go online.' : 'Could not get your location.')),
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  });
}

export function DeliveryHomePage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['delivery', 'me'], queryFn: () => api<MeResponse>('/delivery/me'), refetchInterval: 30_000 });
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['delivery', 'me'] }), [qc]);

  useEffect(() => {
    const s = getSocket();
    const onOffer = () => {
      toast.info('New delivery offer');
      if ('vibrate' in navigator) navigator.vibrate?.(200);
      refresh();
    };
    s.on('delivery:offer', onOffer);
    s.on('delivery:cancelled', refresh);
    s.on('order:updated', refresh);
    s.on('connect', refresh);
    return () => {
      s.off('delivery:offer', onOffer);
      s.off('delivery:cancelled', refresh);
      s.off('order:updated', refresh);
      s.off('connect', refresh);
    };
  }, [refresh]);

  const availability = useMutation({
    mutationFn: async (online: boolean) => api('/delivery/availability', { method: 'POST', body: online ? { online, location: await currentPosition() } : { online } }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Idle heartbeat while online (dispatch position only; no history is kept).
  const online = q.data?.profile.online;
  const hasActive = Boolean(q.data?.active);
  useEffect(() => {
    if (!online || hasActive) return;
    const t = setInterval(() => {
      currentPosition()
        .then((p) => api('/delivery/heartbeat', { method: 'POST', body: p }))
        .catch(() => undefined);
    }, 60_000);
    return () => clearInterval(t);
  }, [online, hasActive]);

  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const { profile, offers, active } = q.data;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title={active ? 'Active delivery' : profile.online ? 'You’re online' : 'You’re offline'}
        sub={profile.approval === 'APPROVED' ? `${profile.vehicle.replace('_', ' ')} · ${profile.vehicleNumber || 'no vehicle number'}` : undefined}
        actions={
          profile.approval === 'APPROVED' && (
            <label className={clsx('flex items-center gap-3 rounded-xl border px-3 py-2 text-sm font-semibold', profile.online ? 'border-leaf-600 bg-leaf-50 text-leaf-700' : 'border-line bg-surface')}>
              <Power className="size-4" aria-hidden /> {profile.online ? 'Online' : 'Go online'}
              <Toggle checked={profile.online} onChange={(v) => availability.mutate(v)} label="Online for deliveries" disabled={availability.isPending || (hasActive && profile.online)} />
            </label>
          )
        }
      />
      {profile.approval !== 'APPROVED' && (
        <Notice tone="warn" title={`Account ${profile.approval.toLowerCase()}`}>
          Our team reviews new partners before you can go online. We’ll notify you once approved.
        </Notice>
      )}

      {active ? (
        <ActiveDelivery order={active} demoAllowed={q.data.demoLocationAllowed} onChange={refresh} />
      ) : profile.online ? (
        offers.length ? (
          <section className="space-y-3" aria-label="Delivery offers">
            {offers.map((o) => (
              <OfferCard key={o.orderId} offer={o} onDone={refresh} />
            ))}
          </section>
        ) : (
          <EmptyState icon={<Radio />} title="Waiting for orders nearby" body="Keep this screen open. Offers appear here and expire after 60 seconds if not accepted." />
        )
      ) : (
        profile.approval === 'APPROVED' && <EmptyState icon={<Power />} title="Go online to receive orders" body="We share your location only for dispatch while you’re online, and with the customer only during an active delivery." />
      )}
    </div>
  );
}

function OfferCard({ offer, onDone }: { offer: Offer; onDone: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((new Date(offer.expiresAt).getTime() - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((new Date(offer.expiresAt).getTime() - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [offer.expiresAt]);
  const respond = useMutation({
    mutationFn: (action: 'accept' | 'decline') => api(`/delivery/offers/${offer.orderId}/${action}`, { method: 'POST' }),
    onSuccess: onDone,
    onError: (e) => {
      toast.error(errorMessage(e));
      onDone();
    },
  });
  return (
    <article className="card overflow-hidden">
      <div className="h-1 bg-line">
        <div className="h-full bg-brand-500 transition-all" style={{ width: `${(left / 60) * 100}%` }} />
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="num font-display text-3xl font-extrabold text-leaf-700">{inr(offer.estimatedEarnings)}</p>
            <p className="text-xs text-muted">estimated payout · {offer.distanceKm} km trip · {offer.items} item(s)</p>
          </div>
          <Badge tone={left < 15 ? 'chili' : 'neutral'}>{left}s</Badge>
        </div>
        <p className="text-sm">
          <Store className="mr-1 inline size-4 text-brand-600" aria-hidden />
          <strong>{offer.restaurant}</strong>, {offer.pickupLocality}
        </p>
        <p className="text-sm">
          <MapPinned className="mr-1 inline size-4 text-ink" aria-hidden /> Drop: {offer.dropLocality}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => respond.mutate('decline')} disabled={respond.isPending}>
            Decline
          </Button>
          <Button variant="success" block size="lg" loading={respond.isPending} disabled={left === 0} onClick={() => respond.mutate('accept')}>
            Accept delivery
          </Button>
        </div>
      </div>
    </article>
  );
}

function ActiveDelivery({ order, demoAllowed, onChange }: { order: Order & { customerPhone?: string; restaurantPhone?: string }; demoAllowed: boolean; onChange: () => void }) {
  const [otp, setOtp] = useState('');
  const step = useMutation({
    mutationFn: (s: 'pickup' | 'start' | 'deliver') => api(`/delivery/orders/${order.id}/${s}`, { method: 'POST', body: s === 'deliver' ? { otp } : {} }),
    onSuccess: (_d, s) => {
      if (s === 'deliver') toast.success('Delivered! Earnings added.');
      onChange();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toRestaurant = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'CONFIRMED'].includes(order.status);
  const drop = order.deliveryAddress!;
  return (
    <div className="space-y-4">
      <LocationSharer orderId={order.id} from={toRestaurant ? null : order.restaurant.location} to={toRestaurant ? order.restaurant.location : drop.location} demoAllowed={demoAllowed} />

      <section className={clsx('card p-4', toRestaurant && 'ring-2 ring-brand-500')}>
        <p className="label">1 · Pickup</p>
        <p className="mt-1 font-bold">{order.restaurant.name}</p>
        <p className="text-sm text-muted">{order.restaurant.locality}</p>
        <p className="mt-1 text-sm">
          {order.orderNumber} · {order.items.reduce((s, i) => s + i.quantity, 0)} items
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={navigationUrl(order.restaurant.location)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-ink px-3 text-sm font-semibold text-white">
            <Navigation className="size-4" aria-hidden /> Navigate
          </a>
          {order.restaurantPhone && (
            <a href={`tel:${order.restaurantPhone}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-sm font-semibold">
              <Phone className="size-4" aria-hidden /> Call restaurant
            </a>
          )}
        </div>
        {toRestaurant && (
          <Button className="mt-3" block size="lg" disabled={order.status !== 'READY_FOR_PICKUP'} loading={step.isPending} onClick={() => step.mutate('pickup')}>
            {order.status === 'READY_FOR_PICKUP' ? 'Confirm pickup' : 'Waiting for food to be ready…'}
          </Button>
        )}
      </section>

      <section className={clsx('card p-4', !toRestaurant && 'ring-2 ring-brand-500')}>
        <p className="label">2 · Drop</p>
        <p className="mt-1 flex items-center gap-1.5 font-bold">
          <User className="size-4" aria-hidden /> {order.customerName}
        </p>
        <p className="text-sm text-muted">
          {drop.line1}
          {drop.line2 ? `, ${drop.line2}` : ''}, {drop.locality}
          {drop.landmark ? ` · Landmark: ${drop.landmark}` : ''} · {drop.pincode}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={navigationUrl(drop.location)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-ink px-3 text-sm font-semibold text-white">
            <Navigation className="size-4" aria-hidden /> Navigate
          </a>
          {order.customerPhone && (
            <a href={`tel:${order.customerPhone}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-sm font-semibold">
              <Phone className="size-4" aria-hidden /> Call customer
            </a>
          )}
        </div>
        {order.status === 'PICKED_UP' && (
          <Button className="mt-3" block size="lg" loading={step.isPending} onClick={() => step.mutate('start')}>
            Start trip to customer
          </Button>
        )}
        {order.status === 'OUT_FOR_DELIVERY' && (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              step.mutate('deliver');
            }}
          >
            <Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="Customer’s 4-digit OTP" aria-label="Delivery OTP" className="num text-center text-lg tracking-[0.4em]" />
            <Button type="submit" variant="success" size="lg" disabled={otp.length !== 4} loading={step.isPending}>
              Delivered
            </Button>
          </form>
        )}
      </section>

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Order timeline</summary>
        <div className="mt-3">
          <OrderTimeline status={order.status} timeline={order.timeline} />
        </div>
      </details>
    </div>
  );
}

/**
 * Shares GPS over Socket.IO only while a delivery is active. Browsers throttle or pause geolocation when the tab is
 * backgrounded; we hold a screen wake lock where supported and tell the partner to keep the screen on.
 */
function LocationSharer({ orderId, from, to, demoAllowed }: { orderId: string; from: LatLng | null; to: LatLng; demoAllowed: boolean }) {
  const [status, setStatus] = useState<{ state: 'idle' | 'sharing' | 'denied' | 'error'; lastSent?: string; accuracy?: number; lastReject?: string }>({ state: 'idle' });
  const [demo, setDemo] = useState(false);
  const lastEmit = useRef(0);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  const send = useCallback(
    (lat: number, lng: number, accuracy: number | undefined, source: 'gps' | 'demo') => {
      const now = Date.now();
      if (now - lastEmit.current < 4000) return;
      lastEmit.current = now;
      getSocket()
        .timeout(5000)
        .emit('location:update', { orderId, lat, lng, accuracy, recordedAt: now, source }, (err: Error | null, ack: { accepted: boolean; reason?: string }) => {
          if (err) return setStatus((s) => ({ ...s, lastReject: 'No connection, retrying' }));
          setStatus((s) => (ack.accepted ? { state: 'sharing', lastSent: new Date(now).toISOString(), accuracy, lastReject: undefined } : { ...s, lastReject: ack.reason }));
        });
    },
    [orderId],
  );

  // Real GPS
  useEffect(() => {
    if (demo) return;
    if (!('geolocation' in navigator)) {
      setStatus({ state: 'error' });
      return;
    }
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => undefined);
    const id = navigator.geolocation.watchPosition(
      (p) => send(p.coords.latitude, p.coords.longitude, p.coords.accuracy, 'gps'),
      (e) => setStatus({ state: e.code === e.PERMISSION_DENIED ? 'denied' : 'error' }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    );
    return () => {
      navigator.geolocation.clearWatch(id);
      void lock?.release();
    };
  }, [send, demo]);

  // Demo mode: deterministic straight-line route, clearly labelled as simulated on both sides.
  useEffect(() => {
    if (!demo) return;
    const start = from ?? { lat: to.lat + 0.012, lng: to.lng - 0.01 };
    let i = 0;
    const steps = 40;
    const t = setInterval(() => {
      i = Math.min(steps, i + 1);
      const f = i / steps;
      lastEmit.current = 0;
      send(start.lat + (to.lat - start.lat) * f, start.lng + (to.lng - start.lng) * f, 10, 'demo');
    }, 4000);
    return () => clearInterval(t);
  }, [demo, from, to, send]);

  return (
    <section className="card space-y-2 p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className={clsx('size-2.5 rounded-full', status.state === 'sharing' ? 'bg-leaf-600' : status.state === 'idle' ? 'bg-turmeric-400' : 'bg-chili-600')} />
          {status.state === 'sharing'
            ? `Sharing ${demo ? 'simulated' : 'live'} location · ${relativeSeconds(status.lastSent!)}${status.accuracy ? ` · ±${Math.round(status.accuracy)} m` : ''}`
            : status.state === 'denied'
              ? 'Location permission denied'
              : status.state === 'error'
                ? 'Location unavailable'
                : 'Starting location…'}
        </p>
        {demoAllowed && (
          <label className="flex items-center gap-2 text-xs font-semibold text-turmeric-600">
            <FlaskConical className="size-3.5" aria-hidden /> Demo route
            <Toggle checked={demo} onChange={setDemo} label="Simulate route (demo)" />
          </label>
        )}
      </div>
      {status.state === 'denied' && <Notice tone="error">The customer can’t see your progress. Allow location for this site in your browser settings, then reload.</Notice>}
      {status.lastReject && <p className="text-xs text-chili-600">Last update not accepted: {status.lastReject.replace(/_/g, ' ')}</p>}
      <p className="text-xs text-muted">Keep this screen on during the delivery. Browsers pause location in the background. Sharing stops automatically when the order is delivered.</p>
    </section>
  );
}
