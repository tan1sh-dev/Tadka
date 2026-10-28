import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  ACTIVE_ORDER_STATUSES,
  menuCategorySchema,
  menuItemSchema,
  objectId,
  restaurantProfileSchema,
} from '@tadka/shared';
import { badRequest, conflict, forbidden, notFound, parse } from '../../lib/errors';
import { currentUser, requireRole } from '../../middleware/auth';
import { fromPoint, toPoint } from '../../models/common';
import { OrderModel } from '../../models/order';
import { PayoutModel } from '../../models/ops';
import { MenuCategoryModel, MenuItemModel, RestaurantModel } from '../../models/restaurant';
import { restaurantUpdateStatus, serializeOrder } from '../orders/orders.service';
import type { Request } from 'express';

export const merchantRouter = Router();
merchantRouter.use(requireRole('restaurant'));

async function myRestaurant(req: Request) {
  const r = await RestaurantModel.findOne({ ownerId: currentUser(req).id });
  if (!r) throw notFound('Restaurant (complete onboarding first)');
  return r;
}

function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'restaurant';
  return `${base}-${crypto.randomBytes(2).toString('hex')}`;
}

function serializeRestaurant(r: InstanceType<typeof RestaurantModel>) {
  const o = r.toObject();
  return {
    ...o,
    id: String(o._id),
    _id: undefined,
    ownerId: undefined,
    location: fromPoint(o.location),
    address: o.address ? { ...o.address, location: fromPoint(o.location) } : null,
  };
}

merchantRouter.post('/restaurant', async (req, res) => {
  const input = parse(restaurantProfileSchema, req.body);
  if (await RestaurantModel.exists({ ownerId: currentUser(req).id })) throw conflict('ALREADY_ONBOARDED', 'You already have a restaurant.');
  const r = await RestaurantModel.create({
    ...input,
    ownerId: currentUser(req).id,
    slug: slugify(input.name),
    address: { ...input.address, location: toPoint(input.address.location) },
    location: toPoint(input.address.location),
    approval: 'PENDING',
  });
  res.status(201).json({ restaurant: serializeRestaurant(r) });
});

merchantRouter.get('/restaurant', async (req, res) => {
  res.json({ restaurant: serializeRestaurant(await myRestaurant(req)) });
});

merchantRouter.put('/restaurant', async (req, res) => {
  const input = parse(restaurantProfileSchema, req.body);
  const r = await myRestaurant(req);
  r.set({
    ...input,
    address: { ...input.address, location: toPoint(input.address.location) },
    location: toPoint(input.address.location),
  });
  await r.save();
  res.json({ restaurant: serializeRestaurant(r) });
});

merchantRouter.post('/restaurant/pause', async (req, res) => {
  const { paused } = parse(z.object({ paused: z.boolean() }), req.body);
  const r = await myRestaurant(req);
  r.isPaused = paused;
  await r.save();
  res.json({ paused });
});

// ── Menu ──────────────────────────────────────────────────────────────────────

merchantRouter.get('/menu', async (req, res) => {
  const r = await myRestaurant(req);
  const [categories, items] = await Promise.all([
    MenuCategoryModel.find({ restaurantId: r._id }).sort({ sortOrder: 1, name: 1 }).lean(),
    MenuItemModel.find({ restaurantId: r._id }).sort({ name: 1 }).lean(),
  ]);
  res.json({
    categories: categories.map((c) => ({ id: String(c._id), name: c.name, sortOrder: c.sortOrder })),
    items: items.map(({ _id, restaurantId: _r, ...i }) => ({ ...i, id: String(_id), categoryId: String(i.categoryId) })),
  });
});

merchantRouter.post('/categories', async (req, res) => {
  const r = await myRestaurant(req);
  const c = await MenuCategoryModel.create({ ...parse(menuCategorySchema, req.body), restaurantId: r._id });
  res.status(201).json({ category: { id: String(c._id), name: c.name, sortOrder: c.sortOrder } });
});

merchantRouter.put('/categories/:id', async (req, res) => {
  const r = await myRestaurant(req);
  const c = await MenuCategoryModel.findOneAndUpdate(
    { _id: parse(objectId, req.params.id), restaurantId: r._id },
    { $set: parse(menuCategorySchema, req.body) },
    { new: true },
  );
  if (!c) throw notFound('Category');
  res.json({ category: { id: String(c._id), name: c.name, sortOrder: c.sortOrder } });
});

merchantRouter.delete('/categories/:id', async (req, res) => {
  const r = await myRestaurant(req);
  const id = parse(objectId, req.params.id);
  if (await MenuItemModel.exists({ categoryId: id, restaurantId: r._id }))
    throw conflict('CATEGORY_NOT_EMPTY', 'Move or delete the dishes in this category first.');
  const d = await MenuCategoryModel.deleteOne({ _id: id, restaurantId: r._id });
  if (!d.deletedCount) throw notFound('Category');
  res.json({ ok: true });
});

async function assertCategory(restaurantId: unknown, categoryId: string) {
  if (!(await MenuCategoryModel.exists({ _id: categoryId, restaurantId }))) throw badRequest('Unknown category');
}

merchantRouter.post('/items', async (req, res) => {
  const r = await myRestaurant(req);
  const input = parse(menuItemSchema, req.body);
  await assertCategory(r._id, input.categoryId);
  if (r.pureVeg && input.diet !== 'veg') throw badRequest('This is a pure-veg restaurant; only veg dishes can be added.');
  const item = await MenuItemModel.create({ ...input, restaurantId: r._id });
  res.status(201).json({ item: { id: String(item._id) } });
});

merchantRouter.put('/items/:id', async (req, res) => {
  const r = await myRestaurant(req);
  const input = parse(menuItemSchema, req.body);
  await assertCategory(r._id, input.categoryId);
  if (r.pureVeg && input.diet !== 'veg') throw badRequest('This is a pure-veg restaurant; only veg dishes can be added.');
  const item = await MenuItemModel.findOneAndUpdate({ _id: parse(objectId, req.params.id), restaurantId: r._id }, { $set: input }, { new: true });
  if (!item) throw notFound('Item');
  res.json({ item: { id: String(item._id) } });
});

merchantRouter.patch('/items/:id/availability', async (req, res) => {
  const r = await myRestaurant(req);
  const { available } = parse(z.object({ available: z.boolean() }), req.body);
  const item = await MenuItemModel.findOneAndUpdate(
    { _id: parse(objectId, req.params.id), restaurantId: r._id },
    { $set: { available } },
    { new: true },
  );
  if (!item) throw notFound('Item');
  res.json({ available: item.available });
});

merchantRouter.delete('/items/:id', async (req, res) => {
  const r = await myRestaurant(req);
  const d = await MenuItemModel.deleteOne({ _id: parse(objectId, req.params.id), restaurantId: r._id });
  if (!d.deletedCount) throw notFound('Item');
  res.json({ ok: true });
});

// ── Orders ───────────────────────────────────────────────────────────────────

merchantRouter.get('/orders', async (req, res) => {
  const r = await myRestaurant(req);
  const { view } = parse(z.object({ view: z.enum(['active', 'history']).default('active') }), req.query);
  const filter =
    view === 'active'
      ? { restaurantId: r._id, status: { $in: ACTIVE_ORDER_STATUSES.filter((s) => !['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(s)) } }
      : { restaurantId: r._id, status: { $in: ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'REJECTED', 'CANCELLED'] } };
  const orders = await OrderModel.find(filter).sort({ createdAt: view === 'active' ? 1 : -1 }).limit(view === 'active' ? 100 : 50);
  res.json({ orders: await Promise.all(orders.map((o) => serializeOrder(o, 'restaurant'))) });
});

merchantRouter.post('/orders/:id/status', async (req, res) => {
  const r = await myRestaurant(req);
  if (r.approval !== 'APPROVED') throw forbidden('Your restaurant is not approved yet');
  const { to, reason } = parse(
    z.object({ to: z.enum(['ACCEPTED', 'REJECTED', 'PREPARING', 'READY_FOR_PICKUP']), reason: z.string().trim().max(200).default('') }),
    req.body,
  );
  if (to === 'REJECTED' && !reason) throw badRequest('Please give the customer a reason for rejecting.');
  const order = await restaurantUpdateStatus(currentUser(req), parse(objectId, req.params.id), to, reason);
  res.json({ order: await serializeOrder(order, 'restaurant') });
});

// ── Analytics (incl. commission transparency) ───────────────────────────────

merchantRouter.get('/analytics', async (req, res) => {
  const r = await myRestaurant(req);
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }), req.query);
  const since = new Date(Date.now() - days * 86400_000);
  const match = { restaurantId: r._id, createdAt: { $gte: since } };
  const [byStatus, delivered, top, daily] = await Promise.all([
    OrderModel.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    OrderModel.aggregate([
      { $match: { ...match, status: 'DELIVERED' } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          itemTotal: { $sum: '$pricing.itemTotal' },
          packaging: { $sum: '$pricing.packagingFee' },
          commission: { $sum: '$commission.amount' },
          gst: { $sum: '$commission.gst' },
          avgPrep: { $avg: { $dateDiff: { startDate: '$acceptedAt', endDate: '$readyAt', unit: 'second' } } },
        },
      },
    ]),
    OrderModel.aggregate([
      { $match: { ...match, status: 'DELIVERED' } },
      { $unwind: '$items' },
      { $group: { _id: '$items.name', qty: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } },
      { $sort: { qty: -1 } },
      { $limit: 8 },
    ]),
    OrderModel.aggregate([
      { $match: { ...match, status: 'DELIVERED' } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } },
          orders: { $sum: 1 },
          gmv: { $sum: '$pricing.itemTotal' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.n])) as Record<string, number>;
  const decided = (counts.REJECTED ?? 0) + Object.entries(counts).filter(([s]) => !['PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFIRMED', 'REJECTED', 'CANCELLED'].includes(s)).reduce((a, [, n]) => a + n, 0);
  const d = delivered[0] ?? { orders: 0, itemTotal: 0, packaging: 0, commission: 0, gst: 0, avgPrep: null };
  res.json({
    days,
    orders: { delivered: d.orders, rejected: counts.REJECTED ?? 0, cancelled: counts.CANCELLED ?? 0 },
    acceptanceRate: decided ? Math.round(((decided - (counts.REJECTED ?? 0)) / decided) * 100) : null,
    avgPrepMinutes: d.avgPrep ? Math.round(d.avgPrep / 6) / 10 : null,
    money: {
      itemTotal: d.itemTotal,
      packaging: d.packaging,
      commission: d.commission,
      gstOnCommission: d.gst,
      net: d.itemTotal + d.packaging - d.commission - d.gst,
      commissionRateBps: r.commissionBps,
    },
    topItems: top.map((t) => ({ name: t._id, qty: t.qty, revenue: t.revenue })),
    daily: daily.map((x) => ({ date: x._id, orders: x.orders, gmv: x.gmv })),
  });
});

merchantRouter.get('/payouts', async (req, res) => {
  const r = await myRestaurant(req);
  const payouts = await PayoutModel.find({ restaurantId: r._id }).sort({ periodStart: -1 }).limit(24).lean();
  res.json({ payouts: payouts.map(({ _id, ...p }) => ({ ...p, id: String(_id) })) });
});
