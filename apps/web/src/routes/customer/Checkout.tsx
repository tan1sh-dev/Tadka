import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Home, Minus, Plus, ShieldAlert, ShoppingBag, Tag } from 'lucide-react';
import type { Quote } from '@tadka/shared';
import { ApiError, api, newIdempotencyKey } from '../../lib/api';
import { useCart, useLocationStore } from '../../lib/stores';
import type { Address, QuoteResponse } from '../../lib/types';
import { errorMessage, inr } from '../../lib/format';
import { useMe } from '../../hooks/useAuth';
import { Badge, Button, DietMark, EmptyState, Input, Modal, Notice, Skeleton, Textarea, toast } from '../../components/ui';
import { PriceBreakdown } from '../../components/PriceBreakdown';
import { AddressForm } from '../../components/AddressForm';

interface Coupon {
  code: string;
  description: string;
  minOrder: number;
  firstOrderOnly: boolean;
}

export function CheckoutPage() {
  const cart = useCart();
  const location = useLocationStore((s) => s.location);
  const { data: me } = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const isCustomer = me?.role === 'customer';

  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => api<{ addresses: Address[] }>('/addresses').then((r) => r.addresses), enabled: isCustomer });
  const [addressId, setAddressId] = useState<string | undefined>(location?.addressId);
  useEffect(() => {
    if (!addressId && addresses.data?.length) setAddressId(addresses.data.find((a) => a.serviceable)?.id ?? addresses.data[0].id);
  }, [addresses.data, addressId]);
  const [addOpen, setAddOpen] = useState(false);
  const [couponInput, setCouponInput] = useState(cart.couponCode);
  const [priceChange, setPriceChange] = useState<{ from: number; to: Quote } | null>(null);

  const quoteBody = useMemo(
    () => ({
      restaurantId: cart.restaurant?.id,
      lines: cart.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, selections: l.selections })),
      ...(isCustomer && addressId ? { addressId } : location ? { location: { lat: location.lat, lng: location.lng } } : {}),
      couponCode: cart.couponCode || undefined,
    }),
    [cart.restaurant?.id, cart.lines, cart.couponCode, isCustomer, addressId, location],
  );
  const quote = useQuery({
    queryKey: ['quote', quoteBody],
    queryFn: () => api<QuoteResponse>('/carts/quote', { method: 'POST', body: quoteBody }),
    enabled: Boolean(cart.restaurant && cart.lines.length),
    placeholderData: (prev) => prev,
  });
  const offers = useQuery({ queryKey: ['promotions'], queryFn: () => api<{ coupons: Coupon[] }>('/promotions').then((r) => r.coupons), staleTime: 300_000 });

  // One idempotency key per distinct order attempt; double-clicks and retries reuse it.
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const sig = JSON.stringify(quoteBody) + (quote.data?.quote.total ?? '');
  if (keyRef.current?.sig !== sig) keyRef.current = { sig, key: newIdempotencyKey() };

  const place = useMutation({
    mutationFn: () =>
      api<{ order: { id: string }; payment: { id: string; checkoutUrl: string | null } | null }>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': keyRef.current!.key },
        body: { ...quoteBody, addressId, expectedTotal: quote.data!.quote.total, instructions: cart.instructions },
      }),
    onSuccess: (r) => {
      cart.clear();
      qc.invalidateQueries({ queryKey: ['orders'] });
      const url = r.payment?.checkoutUrl;
      if (url && url.startsWith(window.location.origin)) nav(url.slice(window.location.origin.length));
      else if (url) window.location.assign(url);
      else nav(`/orders/${r.order.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'PRICE_CHANGED') {
        const d = err.details as { quote: Quote; previousTotal: number };
        setPriceChange({ from: d.previousTotal, to: d.quote });
        quote.refetch();
      } else if (err instanceof ApiError && err.code === 'PAYMENT_PROVIDER_ERROR') {
        const d = err.details as { orderId?: string };
        cart.clear();
        toast.error(err.message);
        if (d?.orderId) nav(`/orders/${d.orderId}`);
      } else toast.error(errorMessage(err));
    },
  });

  if (!cart.restaurant || cart.lines.length === 0)
    return <EmptyState icon={<ShoppingBag />} title="Your cart is empty" body="Find something you’re craving and it’ll show up here, with every fee spelled out." action={<Link to="/" className="font-semibold text-brand-700 underline">Browse restaurants</Link>} />;

  const qd = quote.data;
  const lineBlockers = (i: number) => qd?.blockers.filter((b) => b.lineIndex === i) ?? [];
  const generalBlockers = qd?.blockers.filter((b) => b.lineIndex === undefined && !(b.code === 'NO_LOCATION' && !isCustomer)) ?? [];
  const selected = addresses.data?.find((a) => a.id === addressId);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-5 text-2xl font-extrabold sm:text-3xl">Checkout</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {/* Address */}
          <section className="card p-5" aria-labelledby="addr-h">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="addr-h" className="text-lg font-bold">
                Deliver to
              </h2>
              {isCustomer && (
                <Button variant="ghost" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4" /> New address
                </Button>
              )}
            </div>
            {!me ? (
              <Notice>
                <Link to="/login?next=/checkout" className="font-semibold underline">
                  Log in
                </Link>{' '}
                or{' '}
                <Link to="/register?next=/checkout" className="font-semibold underline">
                  create an account
                </Link>{' '}
                to choose an address and pay. Prices below are for {location?.label ?? 'your area'}.
              </Notice>
            ) : !isCustomer ? (
              <Notice tone="warn">You’re signed in as a {me.role}. Use a customer account to place orders.</Notice>
            ) : addresses.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : addresses.data?.length ? (
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Delivery address">
                {addresses.data.map((a) => (
                  <button
                    key={a.id}
                    role="radio"
                    aria-checked={a.id === addressId}
                    onClick={() => setAddressId(a.id)}
                    className={clsx('flex gap-3 rounded-xl border p-3 text-left', a.id === addressId ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-line-strong')}
                  >
                    <Home className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 text-sm">
                      <span className="flex items-center gap-2 font-semibold">
                        {a.label}
                        {a.serviceable === false && <Badge tone="chili">Not serviceable</Badge>}
                      </span>
                      <span className="block text-muted">
                        {a.line1}, {a.locality}
                        {a.landmark ? ` (${a.landmark})` : ''} · {a.pincode}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-sm">
                <p className="text-muted">Add your flat/house number and a landmark so the partner finds you easily.</p>
                <Button className="mt-3" onClick={() => setAddOpen(true)}>
                  Add address
                </Button>
              </div>
            )}
          </section>

          {/* Items */}
          <section className="card p-5" aria-labelledby="items-h">
            <h2 id="items-h" className="text-lg font-bold">
              {cart.restaurant.name}
            </h2>
            <ul className="mt-3 divide-y divide-line">
              {cart.lines.map((l, i) => {
                const server = qd?.lines.find((x) => x.menuItemId === l.menuItemId && x.quantity === l.quantity);
                return (
                  <li key={l.key} className="py-3">
                    <div className="flex items-start gap-3">
                      <DietMark diet={l.diet} className="mt-1" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{l.name}</p>
                        {l.optionsLabel && <p className="text-xs text-muted">{l.optionsLabel}</p>}
                      </div>
                      <div className="flex items-center rounded-lg border border-line-strong">
                        <button className="grid size-8 place-items-center" onClick={() => cart.setQty(l.key, l.quantity - 1)} aria-label={`Remove one ${l.name}`}>
                          <Minus className="size-3.5" />
                        </button>
                        <span className="num w-6 text-center text-sm font-semibold">{l.quantity}</span>
                        <button className="grid size-8 place-items-center" onClick={() => cart.setQty(l.key, l.quantity + 1)} aria-label={`Add one ${l.name}`}>
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                      <span className="num w-20 text-right text-sm font-semibold">{inr(server?.lineTotal ?? l.unitPrice * l.quantity)}</span>
                    </div>
                    {lineBlockers(i).map((b) => (
                      <p key={b.message} className="mt-1.5 flex items-start gap-1 text-xs font-semibold text-chili-600">
                        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {b.message}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
            <label className="mt-3 block">
              <span className="text-sm font-medium text-ink-2">Note for the restaurant (optional)</span>
              <Textarea value={cart.instructions} onChange={(e) => cart.setInstructions(e.target.value)} maxLength={200} placeholder="Less spicy, no onions…" className="mt-1.5 min-h-16" />
            </label>
          </section>

          {/* Offers */}
          <section className="card p-5" aria-labelledby="offers-h">
            <h2 id="offers-h" className="flex items-center gap-2 text-lg font-bold">
              <Tag className="size-5 text-brand-600" aria-hidden /> Offers
            </h2>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                cart.setCoupon(couponInput.trim().toUpperCase());
              }}
            >
              <Input value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} placeholder="Coupon code" aria-label="Coupon code" className="uppercase" />
              <Button type="submit" variant="secondary">
                Apply
              </Button>
              {cart.couponCode && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    cart.setCoupon('');
                    setCouponInput('');
                  }}
                >
                  Remove
                </Button>
              )}
            </form>
            {qd?.couponError && <p className="mt-2 text-sm font-medium text-chili-600">{qd.couponError.message}</p>}
            {qd?.coupon && <p className="mt-2 text-sm font-semibold text-leaf-700">✓ {qd.coupon.code} applied — {qd.coupon.description}</p>}
            {(offers.data?.length ?? 0) > 0 && (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {offers.data!.map((c) => (
                  <li key={c.code}>
                    <button
                      onClick={() => {
                        setCouponInput(c.code);
                        cart.setCoupon(c.code);
                      }}
                      className="w-full rounded-xl border border-dashed border-brand-200 bg-brand-50/50 p-3 text-left hover:border-brand-500"
                    >
                      <span className="font-mono text-sm font-bold text-brand-700">{c.code}</span>
                      <span className="block text-xs text-ink-2">{c.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Bill */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <section className="card p-5" aria-labelledby="bill-h" aria-busy={quote.isFetching}>
            <h2 id="bill-h" className="mb-3 text-lg font-bold">
              Bill details
            </h2>
            {quote.isError ? (
              <Notice tone="error">{errorMessage(quote.error)}</Notice>
            ) : !qd ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <PriceBreakdown quote={qd.quote} />
            )}
            {generalBlockers.map((b) => (
              <div key={b.message} className="mt-3">
                <Notice tone="error">{b.message}</Notice>
              </div>
            ))}
            {selected?.serviceable === false && (
              <div className="mt-3">
                <Notice tone="error">This address is outside our delivery zone.</Notice>
              </div>
            )}
            <Button
              block
              size="lg"
              className="mt-4"
              disabled={!isCustomer || !addressId || !qd?.canOrder || quote.isFetching}
              loading={place.isPending}
              onClick={() => place.mutate()}
            >
              {qd ? `Pay ${inr(qd.quote.total)}` : 'Pay'}
            </Button>
            <p className="mt-2 text-center text-xs text-muted">You’ll be taken to a secure payment page. Your order is confirmed only after the payment provider confirms it.</p>
          </section>
        </aside>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add a delivery address" wide>
        <AddressForm
          onSaved={(a) => {
            setAddOpen(false);
            setAddressId(a.id);
            qc.invalidateQueries({ queryKey: ['addresses'] });
          }}
        />
      </Modal>
      <Modal
        open={!!priceChange}
        onClose={() => setPriceChange(null)}
        title="Your total changed"
        footer={
          <Button block onClick={() => setPriceChange(null)}>
            Review updated bill
          </Button>
        }
      >
        {priceChange && (
          <p className="text-sm text-ink-2">
            Something changed since you opened this page (a price, availability or a coupon rule). Your total went from{' '}
            <strong className="num">{inr(priceChange.from)}</strong> to <strong className="num">{inr(priceChange.to.total)}</strong>. Nothing was charged.
          </p>
        )}
      </Modal>
    </div>
  );
}
