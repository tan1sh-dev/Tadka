import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { BadgeCheck, Clock, Flame, Info, MapPin, Search, ShieldAlert, ShieldCheck, Star } from 'lucide-react';
import { ALLERGEN_LABELS, PROFILE_DIET_LABELS, type Allergen } from '@tadka/shared';
import { api } from '../../lib/api';
import { useCart, useLocationStore } from '../../lib/stores';
import type { MenuItem, RestaurantDetail } from '../../lib/types';
import { formatDate, inr } from '../../lib/format';
import { Badge, Button, DietMark, EmptyState, ErrorState, Modal, Notice, Rating, Skeleton, toast } from '../../components/ui';
import { CoverImage } from '../../components/FoodArt';
import { ItemCustomizer, type Customised } from '../../components/ItemCustomizer';

export function RestaurantPage() {
  const { slug } = useParams();
  const location = useLocationStore((s) => s.location);
  const q = useQuery({
    queryKey: ['restaurant', slug, location?.lat, location?.lng],
    queryFn: () => api<RestaurantDetail>(`/restaurants/${slug}${location ? `?lat=${location.lat}&lng=${location.lng}` : ''}`),
  });
  const cart = useCart();
  const [customising, setCustomising] = useState<MenuItem | null>(null);
  const [pendingReplace, setPendingReplace] = useState<{ item: MenuItem; c: Customised } | null>(null);
  const [menuQ, setMenuQ] = useState('');
  const [vegOnly, setVegOnly] = useState(false);

  const grouped = useMemo(() => {
    if (!q.data) return [];
    const needle = menuQ.trim().toLowerCase();
    return q.data.categories
      .map((c) => ({
        ...c,
        items: q.data.items.filter(
          (i) => i.categoryId === c.id && (!vegOnly || i.diet === 'veg') && (!needle || `${i.name} ${i.description} ${i.tags.join(' ')}`.toLowerCase().includes(needle)),
        ),
      }))
      .filter((c) => c.items.length);
  }, [q.data, menuQ, vegOnly]);

  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full rounded-3xl" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );

  const { restaurant: r, fees, dietaryProfile } = q.data;
  const ref = { id: r.id, slug: r.slug, name: r.name };
  const canOrder = r.open && r.deliverable !== false;

  const commit = (item: MenuItem, c: Customised) => {
    cart.add(ref, { menuItemId: item.id, name: item.name, diet: item.diet, ...c });
    toast.success(`Added ${item.name}`);
  };
  const addItem = (item: MenuItem, c: Customised) => {
    if (cart.restaurant && cart.restaurant.id !== r.id && cart.lines.length) return setPendingReplace({ item, c });
    commit(item, c);
  };
  const quickAdd = (item: MenuItem) => {
    if (item.optionGroups.length) return setCustomising(item);
    addItem(item, { quantity: 1, selections: [], optionsLabel: '', unitPrice: item.price });
  };
  const inCart = (id: string) => cart.restaurant?.id === r.id ? cart.lines.filter((l) => l.menuItemId === id).reduce((s, l) => s + l.quantity, 0) : 0;

  return (
    <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-8">
      <div className="min-w-0 space-y-6">
        <header className="overflow-hidden rounded-3xl border border-line bg-surface">
          <CoverImage src={r.imageUrl} name={r.name} hint={r.cuisines.join(' ')} className="h-40 w-full sm:h-56" rounded="rounded-none" iconSize="size-16" />
          <div className="space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold sm:text-3xl">{r.name}</h1>
                <p className="text-sm text-muted">
                  {r.cuisines.join(' · ')} · {r.address.locality}
                </p>
              </div>
              <Rating avg={r.rating.avg} count={r.rating.count} />
            </div>
            <p className="text-sm text-ink-2">{r.description}</p>
            <div className="flex flex-wrap gap-2 text-sm">
              {r.eta && (
                <Badge tone="neutral">
                  <Clock className="size-3.5" aria-hidden /> {r.eta.minMinutes}–{r.eta.maxMinutes} min
                </Badge>
              )}
              {r.distanceKm !== null && (
                <Badge tone="neutral">
                  <MapPin className="size-3.5" aria-hidden /> {r.distanceKm} km
                </Badge>
              )}
              <Badge tone="neutral">{inr(r.priceForTwo, true)} for two</Badge>
              {r.pureVeg && <Badge tone="leaf">Pure veg</Badge>}
              {r.demo && <Badge tone="turmeric">Demo restaurant</Badge>}
            </div>
            {!r.open && <Notice tone="warn">{r.paused ? 'Not accepting orders right now.' : 'Closed right now.'} You can browse the menu.</Notice>}
            {r.deliverable === false && <Notice tone="error">This restaurant doesn’t deliver to your selected location ({r.distanceKm} km away).</Notice>}
          </div>
        </header>

        {/* Honest Price: fees for this restaurant, visible before the cart */}
        <details className="card group p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
            <span className="inline-flex items-center gap-2 font-semibold">
              <Info className="size-4 text-brand-600" aria-hidden /> What you’ll pay on top of menu prices
            </span>
            <span className="text-xs text-muted group-open:hidden">Show</span>
          </summary>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <li>
              Delivery: <strong className="num">{r.deliveryFee !== null ? inr(r.deliveryFee) : 'set location'}</strong>
              {fees.freeDeliveryAbove ? <span className="text-muted"> · free above {inr(fees.freeDeliveryAbove, true)}</span> : null}
            </li>
            <li>
              Platform fee: <strong className="num">{inr(fees.platformFee)}</strong> <span className="text-muted">flat</span>
            </li>
            <li>
              Packaging: <strong className="num">{inr(r.packagingFee)}</strong> <span className="text-muted">set by restaurant</span>
            </li>
            <li>
              Small-order fee: <strong className="num">{inr(fees.smallCartFee)}</strong> <span className="text-muted">below {inr(fees.smallCartThreshold, true)}</span>
            </li>
            <li className="sm:col-span-2 text-muted">
              GST: {fees.foodGstBps / 100}% on food, {fees.feeGstBps / 100}% on fees. FSSAI licence {r.fssaiLicense}.
            </li>
          </ul>
        </details>

        {dietaryProfile ? (
          <p className="inline-flex items-center gap-2 rounded-xl bg-leaf-50 px-3 py-2 text-sm font-medium text-leaf-700">
            <ShieldCheck className="size-4" aria-hidden /> Dietary Guard: {PROFILE_DIET_LABELS[dietaryProfile.diet]}
            {dietaryProfile.avoidAllergens.length > 0 && `, no ${dietaryProfile.avoidAllergens.map((a) => ALLERGEN_LABELS[a].toLowerCase()).join(', ')}`}.
            Dishes that conflict are marked and can’t be added.
          </p>
        ) : null}

        <div className="sticky top-16 z-20 -mx-4 space-y-3 bg-paper/95 px-4 py-3 backdrop-blur">
          <div className="flex gap-2">
            <label className="relative flex-1">
              <span className="sr-only">Search this menu</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input value={menuQ} onChange={(e) => setMenuQ(e.target.value)} placeholder="Search in menu" className="h-10 w-full rounded-xl border border-line-strong bg-surface pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none" />
            </label>
            {!r.pureVeg && (
              <button aria-pressed={vegOnly} onClick={() => setVegOnly((v) => !v)} className={clsx('inline-flex items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold', vegOnly ? 'border-leaf-600 bg-leaf-50 text-leaf-700' : 'border-line-strong bg-surface')}>
                <DietMark diet="veg" /> Veg
              </button>
            )}
          </div>
          <nav aria-label="Menu categories" className="-mx-4 flex gap-2 overflow-x-auto px-4">
            {grouped.map((c) => (
              <a key={c.id} href={`#cat-${c.id}`} className="shrink-0 rounded-full bg-surface px-3 py-1 text-sm font-medium text-ink-2 ring-1 ring-line hover:ring-ink-2">
                {c.name}
              </a>
            ))}
          </nav>
        </div>

        {grouped.length === 0 && <EmptyState icon={<Search />} title="No dishes match" body="Try another word or turn off the veg filter." />}
        {grouped.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} className="scroll-mt-40" aria-labelledby={`h-${c.id}`}>
            <h2 id={`h-${c.id}`} className="mb-3 text-xl font-bold">
              {c.name} <span className="text-sm font-medium text-muted">({c.items.length})</span>
            </h2>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
              {c.items.map((item) => (
                <MenuRow key={item.id} item={item} count={inCart(item.id)} canOrder={canOrder} onAdd={() => quickAdd(item)} />
              ))}
            </ul>
          </section>
        ))}

        {q.data.reviews.length > 0 && (
          <section aria-labelledby="reviews-h">
            <h2 id="reviews-h" className="mb-3 text-xl font-bold">
              Recent reviews
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {q.data.reviews.map((v) => (
                <li key={v.id} className="card p-4 text-sm">
                  <p className="flex items-center justify-between">
                    <span className="font-semibold">{v.name}</span>
                    <span className="inline-flex items-center gap-0.5 font-semibold">
                      {v.rating}
                      <Star className="size-3.5 fill-turmeric-400 text-turmeric-400" aria-hidden />
                    </span>
                  </p>
                  {v.comment && <p className="mt-1 text-ink-2">{v.comment}</p>}
                  <p className="mt-1 text-xs text-muted">Verified order · {formatDate(v.createdAt)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="hidden lg:block">
        <MiniCart />
      </aside>

      {customising && (
        <ItemCustomizer
          item={customising}
          profile={dietaryProfile}
          onClose={() => setCustomising(null)}
          onAdd={(c) => {
            addItem(customising, c);
            setCustomising(null);
          }}
        />
      )}
      <Modal
        open={!!pendingReplace}
        onClose={() => setPendingReplace(null)}
        title="Start a new cart?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingReplace(null)}>
              Keep current cart
            </Button>
            <Button
              onClick={() => {
                cart.clear();
                commit(pendingReplace!.item, pendingReplace!.c);
                setPendingReplace(null);
              }}
            >
              Start new cart
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-2">
          Your cart has items from <strong>{cart.restaurant?.name}</strong>. Orders come from one restaurant at a time so they arrive together and hot.
        </p>
      </Modal>
    </div>
  );
}

function MenuRow({ item, count, canOrder, onAdd }: { item: MenuItem; count: number; canOrder: boolean; onAdd: () => void }) {
  const blocked = !item.dietary.ok;
  return (
    <li className={clsx('flex gap-4 p-4', (!item.available || blocked) && 'bg-paper/60')}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <DietMark diet={item.diet} />
          {item.isBestseller && (
            <Badge tone="brand">
              <BadgeCheck className="size-3" aria-hidden /> Bestseller
            </Badge>
          )}
          {item.jainFriendly && <Badge tone="leaf">Jain</Badge>}
          {item.vegan && <Badge tone="leaf">Vegan</Badge>}
        </div>
        <h3 className="font-semibold">{item.name}</h3>
        <p className="num text-sm font-semibold">{inr(item.price)}</p>
        {item.spiceLevel > 0 && (
          <p className="flex items-center gap-0.5 text-chili-600" aria-label={`Spice level ${item.spiceLevel} of 3`}>
            {Array.from({ length: item.spiceLevel }, (_, i) => (
              <Flame key={i} className="size-3.5 fill-current" aria-hidden />
            ))}
          </p>
        )}
        <p className="line-clamp-2 text-sm text-muted">{item.description}</p>
        {item.allergens.length > 0 && <p className="text-xs text-muted">Contains: {item.allergens.map((a) => ALLERGEN_LABELS[a as Allergen]).join(', ')}</p>}
        {blocked && (
          <p className="inline-flex items-center gap-1 text-xs font-semibold text-chili-600">
            <ShieldAlert className="size-3.5" aria-hidden /> Doesn’t fit your profile: {item.dietary.reasons.join(', ')}
          </p>
        )}
      </div>
      <div className="relative w-28 shrink-0 sm:w-32">
        <CoverImage src={item.imageUrl} name={item.name} hint={item.tags.join(' ')} className="aspect-square w-full" rounded="rounded-xl" iconSize="size-8" />
        <div className="absolute inset-x-2 -bottom-3">
          {!item.available ? (
            <span className="block rounded-lg bg-surface py-1.5 text-center text-xs font-bold text-muted shadow ring-1 ring-line">Sold out</span>
          ) : (
            <button
              onClick={onAdd}
              disabled={!canOrder || blocked}
              aria-label={`Add ${item.name}`}
              className="block w-full rounded-lg bg-surface py-1.5 text-center text-sm font-extrabold text-leaf-700 shadow ring-1 ring-line hover:bg-leaf-50 disabled:cursor-not-allowed disabled:text-muted"
            >
              {count > 0 ? `${count} in cart · +` : 'ADD'}
            </button>
          )}
          {item.optionGroups.length > 0 && item.available && <span className="mt-1 block text-center text-[10px] text-muted">customisable</span>}
        </div>
      </div>
    </li>
  );
}

function MiniCart() {
  const { lines, restaurant } = useCart();
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  return (
    <div className="card sticky top-24 p-4">
      <h2 className="text-lg font-bold">Your cart</h2>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Add dishes to see the full, all-in price.</p>
      ) : (
        <>
          <p className="text-xs text-muted">from {restaurant?.name}</p>
          <ul className="mt-3 space-y-2 text-sm">
            {lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-2">
                <span className="min-w-0">
                  {l.quantity} × {l.name}
                  {l.optionsLabel && <span className="block truncate text-xs text-muted">{l.optionsLabel}</span>}
                </span>
                <span className="num shrink-0">{inr(l.unitPrice * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex justify-between border-t border-line pt-3 text-sm font-semibold">
            <span>Item total</span>
            <span className="num">{inr(subtotal)}</span>
          </p>
          <Link to="/checkout" className="mt-3 block rounded-xl bg-brand-500 py-2.5 text-center text-sm font-bold text-white hover:bg-brand-600">
            See all-in total
          </Link>
        </>
      )}
    </div>
  );
}
