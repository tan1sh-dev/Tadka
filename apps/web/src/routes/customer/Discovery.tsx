import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import clsx from 'clsx';
import { BadgeIndianRupee, Clock4, MapPinOff, Search, ShieldCheck, SlidersHorizontal, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { useLocationStore } from '../../lib/stores';
import type { RestaurantCard as Card } from '../../lib/types';
import { RestaurantCard, RestaurantCardSkeleton } from '../../components/RestaurantCard';
import { LocationPicker } from '../../components/LocationPicker';
import { Button, EmptyState, ErrorState, Select } from '../../components/ui';
import { FoodArt } from '../../components/FoodArt';
import { useMe } from '../../hooks/useAuth';

interface ListResponse {
  serviceable: boolean;
  zone?: { name: string; city: string };
  understood: string[];
  restaurants: Card[];
  sponsored: Card | null;
  total: number;
  hasMore: boolean;
}

const FILTERS = [
  { key: 'veg', label: 'Pure veg', param: ['veg', 'true'] },
  { key: 'rating', label: 'Rated 4.0+', param: ['minRating', '4'] },
  { key: 'fast', label: 'Under 35 min', param: ['maxEta', '35'] },
  { key: 'budget', label: 'Under ₹400 for two', param: ['maxCostForTwo', '400'] },
] as const;

const CRAVINGS = ['spicy veg under 200', 'biryani', 'light & healthy', 'dosa', 'something sweet', 'protein bowl', 'quick street food', 'jain'];

function useDiscovery(q: string) {
  const location = useLocationStore((s) => s.location);
  const [params] = useSearchParams();
  const qs = new URLSearchParams();
  if (location) {
    qs.set('lat', String(location.lat));
    qs.set('lng', String(location.lng));
  }
  if (q) qs.set('q', q);
  for (const k of ['cuisine', 'veg', 'minRating', 'maxEta', 'maxCostForTwo', 'sort']) {
    const v = params.get(k);
    if (v) qs.set(k, v);
  }
  const { data: me } = useMe();
  return {
    location,
    query: useQuery({
      queryKey: ['restaurants', qs.toString(), me?.id, me?.dietary],
      queryFn: () => api<ListResponse>(`/restaurants?${qs}`),
      enabled: Boolean(location),
      placeholderData: (prev) => prev,
    }),
  };
}

function FilterBar() {
  const [params, setParams] = useSearchParams();
  const cuisines = useQuery({ queryKey: ['cuisines'], queryFn: () => api<{ cuisines: string[] }>('/restaurants/cuisines').then((r) => r.cuisines), staleTime: 300_000 });
  const toggle = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (p.get(k) === v) p.delete(k);
    else p.set(k, v);
    setParams(p, { replace: true });
  };
  return (
    <div className="space-y-4">
      {cuisines.data && (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1" role="list" aria-label="Cuisines">
          {cuisines.data.map((c) => {
            const on = params.get('cuisine') === c;
            return (
              <button key={c} role="listitem" onClick={() => toggle('cuisine', c)} aria-pressed={on} className="group flex w-20 shrink-0 flex-col items-center gap-1.5">
                <FoodArt name={c} hint={c} className={clsx('size-16 ring-offset-2 transition', on && 'ring-2 ring-brand-500')} rounded="rounded-full" iconSize="size-6" />
                <span className={clsx('line-clamp-1 text-xs font-semibold', on ? 'text-brand-700' : 'text-ink-2')}>{c}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SlidersHorizontal className="size-4 text-muted" aria-hidden />
        {FILTERS.map((f) => {
          const on = params.get(f.param[0]) === f.param[1];
          return (
            <button
              key={f.key}
              aria-pressed={on}
              onClick={() => toggle(f.param[0], f.param[1])}
              className={clsx('rounded-full border px-3 py-1.5 text-sm font-semibold transition', on ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface hover:border-ink-2')}
            >
              {f.label}
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted">Sort</span>
          <Select
            value={params.get('sort') ?? 'relevance'}
            onChange={(e) => {
              const p = new URLSearchParams(params);
              if (e.target.value === 'relevance') p.delete('sort');
              else p.set('sort', e.target.value);
              setParams(p, { replace: true });
            }}
            className="h-9 w-auto py-0 text-sm"
          >
            <option value="relevance">Relevance</option>
            <option value="eta">Fastest delivery</option>
            <option value="rating">Rating</option>
            <option value="cost">Cost: low to high</option>
            <option value="distance">Distance</option>
          </Select>
        </label>
      </div>
    </div>
  );
}

function Results({ q }: { q: string }) {
  const { location, query } = useDiscovery(q);
  const [picker, setPicker] = useState(false);
  const { data: me } = useMe();
  if (!location)
    return (
      <>
        <EmptyState icon={<MapPinOff />} title="Where are you ordering to?" body="Set a delivery location to see restaurants, real delivery fees and time ranges." action={<Button onClick={() => setPicker(true)}>Set location</Button>} />
        <LocationPicker open={picker} onClose={() => setPicker(false)} />
      </>
    );
  if (query.isError) return <ErrorState error={query.error} retry={() => query.refetch()} />;
  if (!query.data)
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <RestaurantCardSkeleton key={i} />
        ))}
      </div>
    );
  const d = query.data;
  if (!d.serviceable)
    return (
      <>
        <EmptyState icon={<MapPinOff />} title="We’re not in your area yet" body="Tadka currently delivers in parts of south-east Bengaluru. Try another address." action={<Button onClick={() => setPicker(true)}>Change location</Button>} />
        <LocationPicker open={picker} onClose={() => setPicker(false)} />
      </>
    );
  return (
    <div className="space-y-5" aria-busy={query.isFetching}>
      {d.understood.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <Sparkles className="size-4 text-turmeric-600" aria-hidden /> Showing
          {d.understood.map((u) => (
            <span key={u} className="rounded-full bg-turmeric-100 px-2 py-0.5 font-semibold">
              {u}
            </span>
          ))}
        </p>
      )}
      {me?.dietary?.enabled && (
        <p className="inline-flex items-center gap-1.5 rounded-full bg-leaf-50 px-3 py-1 text-xs font-semibold text-leaf-700">
          <ShieldCheck className="size-3.5" aria-hidden /> Dietary Guard on — only restaurants with dishes that fit your profile
        </p>
      )}
      {d.sponsored && (
        <section aria-label="Sponsored">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <RestaurantCard r={d.sponsored} ad />
          </div>
          <p className="mt-1.5 text-xs text-muted">Sponsored placement. It doesn’t affect the ranking below.</p>
        </section>
      )}
      {d.restaurants.length === 0 ? (
        <EmptyState icon={<Search />} title={q ? `Nothing matches “${q}” nearby` : 'No restaurants match these filters'} body="Try fewer filters, a higher budget, or a different craving." />
      ) : (
        <>
          <h2 className="text-lg font-bold">
            {d.total} restaurant{d.total === 1 ? '' : 's'} {q ? 'for your craving' : 'deliver to you'}
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {d.restaurants.map((r) => (
              <RestaurantCard key={r.id} r={r} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function HomePage() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-ink px-5 py-8 text-white sm:px-10 sm:py-12">
        <div className="absolute -right-16 -top-16 size-64 rounded-full bg-brand-500/40 blur-3xl" aria-hidden />
        <div className="absolute -bottom-20 right-24 size-48 rounded-full bg-turmeric-400/30 blur-3xl" aria-hidden />
        <div className="relative max-w-xl">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
            <BadgeIndianRupee className="size-3.5" aria-hidden /> No surprise fees. Ever.
          </p>
          <h1 className="text-3xl font-extrabold leading-[1.05] sm:text-5xl">What are you craving?</h1>
          <p className="mt-3 text-white/75">Describe it the way you’d say it. We’ll show the all-in price and an honest delivery window.</p>
          <form
            role="search"
            className="mt-6 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <label className="relative flex-1">
              <span className="sr-only">Describe your craving</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="spicy veg under 200…"
                className="h-13 w-full rounded-2xl bg-white pl-11 pr-3 text-base text-ink placeholder:text-muted focus:outline-none focus:ring-4 focus:ring-brand-500/50"
              />
            </label>
            <Button type="submit" size="lg" className="h-13 rounded-2xl">
              Find
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {CRAVINGS.map((c) => (
              <button key={c} onClick={() => nav(`/search?q=${encodeURIComponent(c)}`)} className="rounded-full border border-white/20 px-3 py-1 text-sm text-white/90 hover:bg-white/10">
                {c}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Our promises">
        {[
          { icon: BadgeIndianRupee, title: 'All-in prices', body: 'Cards show what an order really costs, including fees & GST.' },
          { icon: Clock4, title: 'Honest time ranges', body: 'A window, not a fake promise, and the reason when it changes.' },
          { icon: ShieldCheck, title: 'Dietary Guard', body: 'Jain, veg, vegan or allergies: we block what doesn’t fit.' },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex gap-3 rounded-2xl border border-line bg-surface p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
              <Icon className="size-5" aria-hidden />
            </span>
            <span>
              <span className="block font-bold">{title}</span>
              <span className="block text-sm text-muted">{body}</span>
            </span>
          </div>
        ))}
      </section>

      <FilterBar />
      <Results q="" />
    </div>
  );
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  return (
    <div className="space-y-6">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const p = new URLSearchParams(params);
          if (text.trim()) p.set('q', text.trim());
          else p.delete('q');
          setParams(p);
        }}
      >
        <label className="relative block">
          <span className="sr-only">Search dishes, restaurants or cravings</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Try “quick light lunch under 250”"
            className="h-14 w-full rounded-2xl border border-line-strong bg-surface pl-12 pr-4 text-lg focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
          />
        </label>
      </form>
      {!q && (
        <div className="flex flex-wrap gap-2">
          {CRAVINGS.map((c) => (
            <button key={c} onClick={() => setParams({ q: c })} className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand-500">
              {c}
            </button>
          ))}
        </div>
      )}
      <FilterBar />
      <Results q={q} />
    </div>
  );
}
