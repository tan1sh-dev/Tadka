import { Router } from 'express';
import type { FilterQuery } from 'mongoose';
import { z } from 'zod';
import {
  PROFILE_DIET_LABELS,
  checkDietary,
  deliveryFeeFor,
  estimateAllIn,
  estimateEta,
  formatINR,
  haversineKm,
  isOpenAt,
  parseCraving,
  type DietaryProfile,
  type OpeningWindow,
  type ParsedCraving,
} from '@tadka/shared';
import { notFound, parse } from '../../lib/errors';
import { searchLimiter } from '../../middleware/security';
import { fromPoint, toPoint } from '../../models/common';
import { MenuCategoryModel, MenuItemModel, RestaurantModel, type MenuItem } from '../../models/restaurant';
import { ReviewModel } from '../../models/ops';
import { UserModel } from '../../models/user';
import { getPricingConfig } from '../../services/config';
import { findZoneFor } from '../../services/geo';

export const restaurantsRouter = Router();

const listQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  q: z.string().trim().max(100).optional(),
  cuisine: z.string().trim().max(30).optional(),
  veg: z.enum(['true', 'false']).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  maxEta: z.coerce.number().int().min(10).max(120).optional(),
  maxCostForTwo: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['relevance', 'rating', 'eta', 'cost', 'distance']).default('relevance'),
  page: z.coerce.number().int().min(1).max(50).default(1),
});

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TAG_ITEM_FILTERS: Record<string, FilterQuery<MenuItem>> = {
  spicy: { $or: [{ spiceLevel: { $gte: 2 } }, { tags: 'spicy' }] },
};

function itemFilterFor(c: ParsedCraving): FilterQuery<MenuItem>[] {
  const and: FilterQuery<MenuItem>[] = [];
  if (c.terms.length) {
    const re = c.terms.map((t) => new RegExp(escapeRegex(t), 'i'));
    and.push({ $or: [...re.map((r) => ({ name: r })), ...re.map((r) => ({ tags: r })), ...re.map((r) => ({ description: r }))] });
  }
  for (const t of c.tags) and.push(TAG_ITEM_FILTERS[t] ?? { tags: t });
  if (c.maxPrice) and.push({ price: { $lte: c.maxPrice } });
  if (c.diet === 'veg') and.push({ diet: 'veg' });
  if (c.diet === 'eggetarian') and.push({ diet: { $ne: 'nonveg' } });
  if (c.diet === 'jain') and.push({ diet: 'veg', jainFriendly: true });
  if (c.diet === 'vegan') and.push({ diet: 'veg', vegan: true });
  return and;
}

/**
 * Discovery + craving search. Every result carries plain-language "why" reasons; sponsored placement is
 * returned separately and labelled, never mixed into organic ranking.
 */
restaurantsRouter.get('/', searchLimiter, async (req, res) => {
  const f = parse(listQuery, req.query);
  const here = { lat: f.lat, lng: f.lng };
  const zone = await findZoneFor(here);
  if (!zone) return res.json({ serviceable: false, restaurants: [], sponsored: null, understood: [], hasMore: false });

  const cfg = await getPricingConfig();
  const nearby = await RestaurantModel.aggregate([
    {
      $geoNear: {
        near: toPoint(here),
        distanceField: 'distM',
        maxDistance: cfg.maxDeliveryKm * 1000,
        query: { approval: 'APPROVED' },
        spherical: true,
      },
    },
    { $limit: 300 },
  ]);
  let list = nearby.filter((r) => r.distM / 1000 <= r.deliveryRadiusKm);

  const craving = f.q ? parseCraving(f.q) : null;
  const matchedItems = new Map<string, { name: string; price: number }[]>();
  if (craving) {
    const itemAnd = itemFilterFor(craving);
    const items = itemAnd.length
      ? await MenuItemModel.find({ restaurantId: { $in: list.map((r) => r._id) }, available: true, $and: itemAnd })
          .select('restaurantId name price')
          .limit(2000)
          .lean()
      : [];
    for (const it of items) {
      const k = String(it.restaurantId);
      matchedItems.set(k, [...(matchedItems.get(k) ?? []), { name: it.name, price: it.price }]);
    }
    const nameMatches = (r: { name: string; cuisines: string[]; tags: string[] }) =>
      craving.terms.some((t) => [r.name, ...r.cuisines, ...r.tags].some((s) => s.toLowerCase().includes(t))) ||
      craving.tags.some((t) => r.tags.includes(t));
    const needsItems = Boolean(craving.maxPrice || craving.diet);
    list = list.filter((r) => matchedItems.has(String(r._id)) || (!needsItems && nameMatches(r)));
  }

  if (f.cuisine) list = list.filter((r) => r.cuisines.some((c: string) => c.toLowerCase() === f.cuisine!.toLowerCase()));
  if (f.veg === 'true') list = list.filter((r) => r.pureVeg);
  if (f.minRating) list = list.filter((r) => (r.rating?.avg ?? 0) >= f.minRating!);
  if (f.maxCostForTwo) list = list.filter((r) => r.priceForTwo <= f.maxCostForTwo! * 100);

  // Dietary Guard: count dishes that fit the viewer's profile.
  const profile = req.user
    ? ((await UserModel.findById(req.user.id).select('dietary').lean())?.dietary as DietaryProfile | undefined)
    : undefined;
  const fitCounts = new Map<string, number>();
  if (profile?.enabled) {
    const items = await MenuItemModel.find({ restaurantId: { $in: list.map((r) => r._id) }, available: true })
      .select('restaurantId diet vegan jainFriendly allergens')
      .lean();
    for (const it of items) {
      if (checkDietary(profile, it).ok) fitCounts.set(String(it.restaurantId), (fitCounts.get(String(it.restaurantId)) ?? 0) + 1);
    }
    list = list.filter((r) => (fitCounts.get(String(r._id)) ?? 0) > 0);
  }

  const now = new Date();
  const cards = list.map((r) => {
    const distanceKm = Math.round((r.distM / 1000) * 10) / 10;
    const open = !r.isPaused && isOpenAt((r.hours ?? []) as OpeningWindow[], now);
    const eta = estimateEta({
      status: 'CONFIRMED',
      now,
      prepMinutes: r.avgPrepMinutes ?? r.prepTimeMinutes,
      restaurantToCustomerKm: distanceKm,
    })!;
    const matches = matchedItems.get(String(r._id)) ?? [];
    const why: string[] = [];
    if (craving?.terms.length && matches.length) why.push(`${matches.length} dish${matches.length > 1 ? 'es' : ''} match "${craving.terms.join(' ')}"`);
    if (craving?.maxPrice && matches.length) why.push(`Options under ${formatINR(craving.maxPrice)}`);
    if (craving?.tags.length && matches.length) why.push(`Has ${craving.tags.join(' & ')} picks`);
    if (profile?.enabled) why.push(`${fitCounts.get(String(r._id))} dishes fit your ${PROFILE_DIET_LABELS[profile.diet].split(' (')[0].toLowerCase()} profile`);
    if ((r.rating?.count ?? 0) >= 20 && r.rating.avg >= 4.3) why.push(`Loved here: ${r.rating.avg}★ from ${r.rating.count} reviews`);
    if (distanceKm <= 2) why.push(`Close by: ${distanceKm} km`);
    if (r.pureVeg) why.push('Pure veg kitchen');
    let score = matches.length * 3 + (r.rating?.avg ?? 0) - distanceKm * 0.3 + (open ? 5 : -20);
    if (craving?.terms.some((t) => r.name.toLowerCase().includes(t))) score += 6;
    return {
      id: String(r._id),
      slug: r.slug,
      name: r.name,
      cuisines: r.cuisines,
      imageUrl: r.imageUrl,
      rating: r.rating,
      priceForTwo: r.priceForTwo,
      allInForTwo: estimateAllIn(r.priceForTwo, r.packagingFee, distanceKm, cfg),
      deliveryFee: deliveryFeeFor(distanceKm, cfg),
      distanceKm,
      eta: { minMinutes: eta.minMinutes, maxMinutes: eta.maxMinutes },
      open,
      pureVeg: r.pureVeg,
      locality: r.address?.locality,
      sponsored: Boolean(r.sponsored),
      demo: Boolean(r.demo),
      why: why.slice(0, 3),
      matchedItems: matches.slice(0, 3),
      score,
    };
  });

  const filtered = f.maxEta ? cards.filter((c) => c.eta.maxMinutes <= f.maxEta!) : cards;
  const sort = craving?.quick && f.sort === 'relevance' ? 'eta' : f.sort;
  const cmp: Record<typeof sort, (a: (typeof cards)[0], b: (typeof cards)[0]) => number> = {
    relevance: (a, b) => b.score - a.score,
    rating: (a, b) => (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0),
    eta: (a, b) => a.eta.maxMinutes - b.eta.maxMinutes,
    cost: (a, b) => a.priceForTwo - b.priceForTwo,
    distance: (a, b) => a.distanceKm - b.distanceKm,
  };
  // Closed restaurants always sink below open ones, whatever the sort.
  filtered.sort((a, b) => Number(b.open) - Number(a.open) || cmp[sort](a, b));

  const pageSize = 20;
  const start = (f.page - 1) * pageSize;
  const sponsored = f.page === 1 && !craving ? (filtered.find((c) => c.sponsored && c.open) ?? null) : null;
  res.json({
    serviceable: true,
    zone: { name: zone.name, city: zone.city },
    understood: craving?.understood ?? [],
    restaurants: filtered.slice(start, start + pageSize).map(({ score: _s, ...c }) => c),
    sponsored: sponsored && (({ score: _s, ...c }) => c)(sponsored),
    total: filtered.length,
    hasMore: start + pageSize < filtered.length,
  });
});

restaurantsRouter.get('/cuisines', async (_req, res) => {
  const cuisines = await RestaurantModel.distinct('cuisines', { approval: 'APPROVED' });
  res.json({ cuisines: cuisines.sort() });
});

restaurantsRouter.get('/:slug', async (req, res) => {
  const slug = parse(z.string().regex(/^[a-z0-9-]{2,90}$/), req.params.slug);
  const { lat, lng } = parse(z.object({ lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }), req.query);
  const r = await RestaurantModel.findOne({ slug, approval: 'APPROVED' }).lean();
  if (!r) throw notFound('Restaurant');
  const [categories, items, reviews, cfg] = await Promise.all([
    MenuCategoryModel.find({ restaurantId: r._id }).sort({ sortOrder: 1, name: 1 }).lean(),
    MenuItemModel.find({ restaurantId: r._id }).sort({ isBestseller: -1, name: 1 }).lean(),
    ReviewModel.find({ restaurantId: r._id, hidden: false }).sort({ createdAt: -1 }).limit(6).lean(),
    getPricingConfig(),
  ]);
  const profile = req.user
    ? ((await UserModel.findById(req.user.id).select('dietary').lean())?.dietary as DietaryProfile | undefined)
    : undefined;
  const now = new Date();
  const restLoc = fromPoint(r.location)!;
  let distanceKm: number | null = null;
  if (lat !== undefined && lng !== undefined) {
    distanceKm = Math.round(haversineKm(restLoc, { lat, lng }) * 10) / 10;
  }
  const eta =
    distanceKm !== null
      ? estimateEta({ status: 'CONFIRMED', now, prepMinutes: r.avgPrepMinutes ?? r.prepTimeMinutes, restaurantToCustomerKm: distanceKm })
      : null;

  res.json({
    restaurant: {
      id: String(r._id),
      slug: r.slug,
      name: r.name,
      description: r.description,
      cuisines: r.cuisines,
      tags: r.tags,
      imageUrl: r.imageUrl,
      rating: r.rating,
      priceForTwo: r.priceForTwo,
      packagingFee: r.packagingFee,
      pureVeg: r.pureVeg,
      address: { locality: r.address?.locality, city: r.address?.city, line1: r.address?.line1 },
      location: restLoc,
      hours: r.hours,
      open: !r.isPaused && isOpenAt((r.hours ?? []) as OpeningWindow[], now),
      paused: r.isPaused,
      fssaiLicense: r.fssaiLicense,
      deliveryRadiusKm: r.deliveryRadiusKm,
      distanceKm,
      deliverable: distanceKm === null ? null : distanceKm <= r.deliveryRadiusKm && distanceKm <= cfg.maxDeliveryKm,
      deliveryFee: distanceKm === null ? null : deliveryFeeFor(distanceKm, cfg),
      eta: eta && { minMinutes: eta.minMinutes, maxMinutes: eta.maxMinutes, basis: eta.basis },
      demo: r.demo,
    },
    fees: {
      platformFee: cfg.platformFee,
      freeDeliveryAbove: cfg.freeDeliveryAbove,
      smallCartThreshold: cfg.smallCartThreshold,
      smallCartFee: cfg.smallCartFee,
      foodGstBps: cfg.foodGstBps,
      feeGstBps: cfg.feeGstBps,
      deliverySlabs: cfg.deliverySlabs,
    },
    categories: categories.map((c) => ({ id: String(c._id), name: c.name })),
    items: items.map((i) => {
      const guard = checkDietary(profile, i);
      return {
        id: String(i._id),
        categoryId: String(i.categoryId),
        name: i.name,
        description: i.description,
        price: i.price,
        diet: i.diet,
        vegan: i.vegan,
        jainFriendly: i.jainFriendly,
        allergens: i.allergens,
        spiceLevel: i.spiceLevel,
        tags: i.tags,
        imageUrl: i.imageUrl,
        available: i.available,
        isBestseller: i.isBestseller,
        optionGroups: i.optionGroups,
        dietary: guard,
      };
    }),
    reviews: reviews.map((v) => ({
      id: String(v._id),
      name: v.customerName,
      rating: v.foodRating,
      comment: v.comment,
      createdAt: v.createdAt,
    })),
    dietaryProfile: profile?.enabled ? profile : null,
  });
});

export const serviceabilityRouter = Router();
serviceabilityRouter.get('/', async (req, res) => {
  const { lat, lng } = parse(z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }), req.query);
  const zone = await findZoneFor({ lat, lng });
  res.json({ serviceable: Boolean(zone), zone: zone ? { name: zone.name, city: zone.city } : null });
});
