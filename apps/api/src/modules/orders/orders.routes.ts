import { Router } from 'express';
import { z } from 'zod';
import {
  createOrderSchema,
  objectId,
  quoteRequestSchema,
  refundRequestSchema,
  reviewSchema,
  type DietaryProfile,
  type LatLng,
} from '@tadka/shared';
import { AppError, badRequest, conflict, notFound, parse } from '../../lib/errors';
import { withTransaction } from '../../lib/db';
import { currentUser, requireAuth, requireRole } from '../../middleware/auth';
import { fromPoint } from '../../models/common';
import { OrderModel, RefundModel } from '../../models/order';
import { ReviewModel } from '../../models/ops';
import { RestaurantModel } from '../../models/restaurant';
import { AddressModel, UserModel } from '../../models/user';
import { buildServerQuote } from './quote.service';
import { cancelByCustomer, createOrder, retryPayment, serializeOrder } from './orders.service';
import { orderViewerRole } from './orders.access';

export const cartsRouter = Router();

/** Honest Price quote. Anonymous users get a preview; logged-in users also get coupon + dietary checks. */
cartsRouter.post('/quote', async (req, res) => {
  const input = parse(quoteRequestSchema, req.body);
  let location: LatLng | null = input.location ?? null;
  if (input.addressId) {
    if (!req.user) throw badRequest('Log in to use a saved address');
    const a = await AddressModel.findOne({ _id: input.addressId, userId: req.user.id }).lean();
    if (!a) throw notFound('Address');
    location = fromPoint(a.location);
  }
  const user = req.user ? await UserModel.findById(req.user.id).select('dietary').lean() : null;
  const sq = await buildServerQuote({
    restaurantId: input.restaurantId,
    lines: input.lines,
    location,
    couponCode: input.couponCode,
    userId: req.user?.id,
    dietary: (user?.dietary as DietaryProfile) ?? null,
  });
  res.json({
    quote: sq.quote,
    lines: sq.lines.map((l) => ({ ...l, menuItemId: String(l.menuItemId) })),
    distanceKm: sq.distanceKm,
    blockers: sq.blockers,
    coupon: sq.coupon ? { code: sq.coupon.code, description: sq.coupon.description } : null,
    couponError: sq.couponError,
    canOrder: sq.blockers.length === 0 && !sq.couponError,
  });
});

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

ordersRouter.post('/', requireRole('customer'), async (req, res) => {
  const key = req.get('idempotency-key');
  if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw badRequest('Idempotency-Key header is required');
  const input = parse(createOrderSchema, req.body);
  const { order, payment, replayed } = await createOrder(currentUser(req), input, key);
  res.status(replayed ? 200 : 201).json({
    order: await serializeOrder(order, 'customer'),
    payment: payment && { id: String(payment._id), status: payment.status, checkoutUrl: payment.checkoutUrl },
    replayed,
  });
});

ordersRouter.get('/', requireRole('customer'), async (req, res) => {
  const { page } = parse(z.object({ page: z.coerce.number().int().min(1).max(500).default(1) }), req.query);
  const limit = 15;
  const orders = await OrderModel.find({ customerId: currentUser(req).id })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit + 1)
    .select('orderNumber status restaurantId restaurantSnapshot.name items.name items.quantity pricing.total createdAt reviewed refundStatus')
    .lean();
  res.json({
    orders: orders.slice(0, limit).map((o) => ({
      id: String(o._id),
      orderNumber: o.orderNumber,
      status: o.status,
      restaurantId: String(o.restaurantId),
      restaurantName: o.restaurantSnapshot?.name,
      summary: o.items.map((i) => `${i.quantity} × ${i.name}`).join(', '),
      total: o.pricing?.total,
      createdAt: o.createdAt,
      reviewed: o.reviewed,
      refundStatus: o.refundStatus,
    })),
    hasMore: orders.length > limit,
  });
});

ordersRouter.get('/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const role = await orderViewerRole(currentUser(req), id);
  if (!role) throw notFound('Order'); // 404 (not 403) avoids confirming that another user's order exists
  const order = await OrderModel.findById(id);
  res.json({ order: await serializeOrder(order!, role) });
});

ordersRouter.post('/:id/cancel', requireRole('customer'), async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { reason } = parse(z.object({ reason: z.string().trim().max(200).default('') }), req.body);
  const order = await cancelByCustomer(currentUser(req), id, reason);
  res.json({ order: await serializeOrder(order, 'customer') });
});

ordersRouter.post('/:id/payment/retry', requireRole('customer'), async (req, res) => {
  const id = parse(objectId, req.params.id);
  const p = await retryPayment(currentUser(req), id);
  res.json({ payment: p && { id: String(p._id), status: p.status, checkoutUrl: p.checkoutUrl } });
});

ordersRouter.post('/:id/review', requireRole('customer'), async (req, res) => {
  const id = parse(objectId, req.params.id);
  const input = parse(reviewSchema, req.body);
  const user = currentUser(req);
  const review = await withTransaction(async (session) => {
    const order = await OrderModel.findOne({ _id: id, customerId: user.id }).session(session);
    if (!order) throw notFound('Order');
    if (order.status !== 'DELIVERED') throw conflict('NOT_DELIVERED', 'You can review an order after it is delivered.');
    if (order.reviewed) throw conflict('ALREADY_REVIEWED', 'You have already reviewed this order.');
    const [review] = await ReviewModel.create(
      [{ ...input, orderId: order._id, restaurantId: order.restaurantId, customerId: user.id, customerName: user.name.split(' ')[0] }],
      { session },
    );
    order.reviewed = true;
    await order.save({ session });
    // Incremental average keeps the restaurant rating consistent without a full recount.
    const r = await RestaurantModel.findById(order.restaurantId).session(session);
    if (r) {
      const count = (r.rating?.count ?? 0) + 1;
      const avg = ((r.rating?.avg ?? 0) * (count - 1) + input.foodRating) / count;
      r.rating = { avg: Math.round(avg * 10) / 10, count };
      await r.save({ session });
    }
    return review;
  });
  res.status(201).json({ review: { id: String(review._id) } });
});

ordersRouter.post('/:id/refund-requests', requireRole('customer'), async (req, res) => {
  const id = parse(objectId, req.params.id);
  const input = parse(refundRequestSchema, req.body);
  const order = await OrderModel.findOne({ _id: id, customerId: currentUser(req).id });
  if (!order) throw notFound('Order');
  if (!['DELIVERED', 'OUT_FOR_DELIVERY', 'PICKED_UP'].includes(order.status))
    throw conflict('NOT_ELIGIBLE', 'Refund requests are available once your order is on the way or delivered.');
  if (await RefundModel.exists({ orderId: id, kind: 'requested', status: { $in: ['REQUESTED', 'PROCESSING'] } }))
    throw conflict('REQUEST_OPEN', 'You already have an open refund request for this order.');
  const max = (order.pricing?.total ?? 0) - order.refundedAmount;
  const amount = Math.min(input.amount ?? max, max);
  if (amount <= 0) throw new AppError(409, 'NOTHING_TO_REFUND', 'This order has already been fully refunded.');
  const r = await RefundModel.create({
    orderId: id,
    amount,
    kind: 'requested',
    reason: input.reason,
    details: input.details,
    status: 'REQUESTED',
    requestedBy: currentUser(req).id,
  });
  order.supportStatus = 'OPEN';
  await order.save();
  res.status(201).json({ refund: { id: String(r._id), status: r.status, amount: r.amount } });
});

ordersRouter.get('/:id/refunds', requireRole('customer'), async (req, res) => {
  const id = parse(objectId, req.params.id);
  if (!(await OrderModel.exists({ _id: id, customerId: currentUser(req).id }))) throw notFound('Order');
  const list = await RefundModel.find({ orderId: id }).sort({ createdAt: -1 }).lean();
  res.json({
    refunds: list.map((r) => ({
      id: String(r._id),
      amount: r.amount,
      status: r.status,
      reason: r.reason,
      kind: r.kind,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
});
