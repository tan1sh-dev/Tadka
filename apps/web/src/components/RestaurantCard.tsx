import { Link } from 'react-router';
import clsx from 'clsx';
import { Clock, Leaf, Sparkles } from 'lucide-react';
import type { RestaurantCard as Card } from '../lib/types';
import { inr } from '../lib/format';
import { Badge, Rating } from './ui';
import { CoverImage } from './FoodArt';

export function RestaurantCard({ r, ad }: { r: Card; ad?: boolean }) {
  return (
    <Link
      to={`/r/${r.slug}`}
      className={clsx('group card flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]', !r.open && 'opacity-70')}
    >
      <div className="relative">
        <CoverImage src={r.imageUrl} name={r.name} hint={r.cuisines.join(' ')} className="aspect-[16/10] w-full" rounded="rounded-none" iconSize="size-12" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {ad && <Badge tone="ink">Ad · Sponsored</Badge>}
          {!r.open && <Badge tone="ink">Closed now</Badge>}
          {r.pureVeg && (
            <Badge tone="leaf" className="bg-white/95">
              <Leaf className="size-3" aria-hidden /> Pure veg
            </Badge>
          )}
        </div>
        <div className="absolute bottom-3 left-3 rounded-lg bg-white/95 px-2 py-1 text-xs font-bold text-ink shadow">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {r.eta.minMinutes}–{r.eta.maxMinutes} min
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 text-[17px] font-bold group-hover:text-brand-600">{r.name}</h3>
          <Rating avg={r.rating.avg} count={r.rating.count} compact />
        </div>
        <p className="line-clamp-1 text-sm text-muted">
          {r.cuisines.join(' · ')} · {r.locality} · {r.distanceKm} km
        </p>
        {/* Honest Price: the real cost of a typical order, not just the menu price */}
        <p className="text-sm">
          <span className="font-semibold num">≈ {inr(r.allInForTwo, true)} all-in for two</span>
          <span className="text-muted"> · menu {inr(r.priceForTwo, true)} + fees & GST</span>
        </p>
        {r.matchedItems.length > 0 && (
          <p className="line-clamp-1 text-xs text-ink-2">
            {r.matchedItems.map((m) => `${m.name} ${inr(m.price, true)}`).join(' · ')}
          </p>
        )}
        {r.why.length > 0 && (
          <ul className="mt-auto flex flex-wrap gap-1.5 pt-2" aria-label="Why this matches">
            {r.why.map((w) => (
              <li key={w} className="inline-flex items-center gap-1 rounded-full bg-turmeric-100/70 px-2 py-0.5 text-[11px] font-medium text-ink-2">
                <Sparkles className="size-3 text-turmeric-600" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Link>
  );
}

export function RestaurantCardSkeleton() {
  return (
    <div className="card overflow-hidden" aria-hidden>
      <div className="aspect-[16/10] animate-pulse bg-line/70" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-line/70" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-line/70" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-line/70" />
      </div>
    </div>
  );
}
