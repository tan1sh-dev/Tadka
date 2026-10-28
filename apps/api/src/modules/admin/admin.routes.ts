import { Router } from 'express';
import { z } from 'zod';
import { APPROVAL_STATUSES, ORDER_STATUSES, ROLES, couponSchema, objectId, pricingConfigSchema, zoneSchema } from '@tadka/shared';
import { audit } from '../../lib/audit';
import { badRequest, conflict, notFound, parse } from '../../lib/errors';
import { withTransaction } from '../../lib/db';
import { maskPhone } from '../../lib/logger';
import { currentUser, requireRole } from '../../middleware/auth';
import { fromPoint, toPoint } from '../../models/common';
import { CouponModel, OrderModel, PaymentModel, RefundModel } from '../../models/order';
import { AuditLogModel, NotificationModel, PayoutModel, ReviewModel, AssignmentModel } from '../../models/ops';
import { RestaurantModel, ZoneModel } from '../../models/restaurant';
import { PartnerProfileModel, UserModel } from '../../models/user';
import { getPricingConfig, setPricingConfig } from '../../services/config';
import { adminCancel, serializeOrder } from '../orders/orders.service';
import { reassign } from '../delivery/delivery.service';
import { issueRefund } from '../payments/refunds.service';
import { emit, rooms } from '../../realtime/io';

export const adminRouter = Router();
adminRouter.use(requireRole('admin'));

const page = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) });
const PAGE = 25;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Metrics ──────────────────────────────────────────────────────────────────

adminRouter.get('/metrics', async (_req, res) => {
  const since = new Date(Date.now() - 7 * 86400_000);
  const today = new Date(Date.now() - 86400_000);
  const [byStatus, timing, payments, failedSms, openRefunds, pendingRestaurants, pendingPartners, todayOrders] = await Promise.all([
    OrderModel.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 }, gmv: { $sum: '$pricing.total' } } }]),
    OrderModel.aggregate([
      { $match: { status: 'DELIVERED', deliveredAt: { $gte: since } } },
      {
        $project: {
          acceptSec: { $dateDiff: { startDate: '$confirmedAt', endDate: '$acceptedAt', unit: 'second' } },
          totalMin: { $dateDiff: { startDate: '$confirmedAt', endDate: '$deliveredAt', unit: 'minute' } },
          maxMin: '$promisedEta.maxMinutes',
        },
      },
      {
        $group: {
          _id: null,
          n: { $sum: 1 },
          avgAcceptSec: { $avg: '$acceptSec' },
          avgDeliveryMin: { $avg: '$totalMin' },
          onTime: { $sum: { $cond: [{ $and: [{ $ne: ['$maxMin', null] }, { $lte: ['$totalMin', '$maxMin'] }] }, 1, 0] } },
          withPromise: { $sum: { $cond: [{ $ne: ['$maxMin', null] }, 1, 0] } },
        },
      },
    ]),
    PaymentModel.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    NotificationModel.countDocuments({ status: { $in: ['FAILED', 'UNDELIVERED'] }, createdAt: { $gte: since } }),
    RefundModel.countDocuments({ status: { $in: ['REQUESTED', 'FAILED'] } }),
    RestaurantModel.countDocuments({ approval: 'PENDING' }),
    PartnerProfileModel.countDocuments({ approval: 'PENDING' }),
    OrderModel.countDocuments({ createdAt: { $gte: today }, status: { $nin: ['PAYMENT_PENDING', 'PAYMENT_FAILED'] } }),
  ]);
  const t = timing[0];
  const pay = Object.fromEntries(payments.map((p) => [p._id, p.n])) as Record<string, number>;
  const payTotal = Object.values(pay).reduce((a, b) => a + b, 0);
  res.json({
    window: '7d',
    ordersByStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.n])),
    gmvDelivered: byStatus.find((s) => s._id === 'DELIVERED')?.gmv ?? 0,
    ordersLast24h: todayOrders,
    avgAcceptSeconds: t?.avgAcceptSec ? Math.round(t.avgAcceptSec) : null,
    avgDeliveryMinutes: t?.avgDeliveryMin ? Math.round(t.avgDeliveryMin) : null,
    etaOnTimeRate: t?.withPromise ? Math.round((t.onTime / t.withPromise) * 100) : null,
    failedPaymentRate: payTotal ? Math.round((((pay.FAILED ?? 0) + (pay.CANCELED ?? 0)) / payTotal) * 100) : null,
    failedNotifications: failedSms,
    openRefunds,
    pendingApprovals: { restaurants: pendingRestaurants, partners: pendingPartners },
  });
});

// ── Users ────────────────────────────────────────────────────────────────────

adminRouter.get('/users', async (req, res) => {
  const f = parse(page.extend({ role: z.enum(ROLES).optional(), q: z.string().trim().max(60).optional() }), req.query);
  const filter: Record<string, unknown> = {};
  if (f.role) filter.role = f.role;
  if (f.q) filter.$or = [{ name: new RegExp(escapeRegex(f.q), 'i') }, { email: new RegExp(escapeRegex(f.q), 'i') }];
  const users = await UserModel.find(filter).sort({ createdAt: -1 }).skip((f.page - 1) * PAGE).limit(PAGE).lean();
  res.json({
    users: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, phone: maskPhone(u.phone), role: u.role, status: u.status, createdAt: u.createdAt })),
  });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const input = parse(z.object({ status: z.enum(['active', 'suspended']).optional(), role: z.enum(ROLES).optional() }), req.body);
  if (id === currentUser(req).id) throw badRequest('You cannot change your own account here.');
  const before = await UserModel.findById(id).lean();
  if (!before) throw notFound('User');
  await UserModel.updateOne({ _id: id }, { $set: input, $inc: { tokenVersion: 1 } }); // revoke sessions on any change
  await audit(req, 'user.update', 'User', id, { before: { status: before.status, role: before.role }, after: input });
  res.json({ ok: true });
});

// ── Supply approval ──────────────────────────────────────────────────────────

adminRouter.get('/restaurants', async (req, res) => {
  const f = parse(page.extend({ approval: z.enum(APPROVAL_STATUSES).optional() }), req.query);
  const list = await RestaurantModel.find(f.approval ? { approval: f.approval } : {})
    .sort({ createdAt: -1 })
    .skip((f.page - 1) * PAGE)
    .limit(PAGE)
    .lean();
  res.json({
    restaurants: list.map((r) => ({
      id: String(r._id),
      name: r.name,
      slug: r.slug,
      cuisines: r.cuisines,
      locality: r.address?.locality,
      city: r.address?.city,
      fssaiLicense: r.fssaiLicense,
      approval: r.approval,
      sponsored: r.sponsored,
      commissionBps: r.commissionBps,
      rating: r.rating,
      isPaused: r.isPaused,
      demo: r.demo,
      createdAt: r.createdAt,
    })),
  });
});

adminRouter.post('/restaurants/:id/approval', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { approval, note } = parse(z.object({ approval: z.enum(APPROVAL_STATUSES), note: z.string().trim().max(200).default('') }), req.body);
  const r = await RestaurantModel.findById(id);
  if (!r) throw notFound('Restaurant');
  const before = r.approval;
  r.approval = approval;
  await r.save();
  await audit(req, 'restaurant.approval', 'Restaurant', id, { before, after: approval, note });
  res.json({ approval });
});

adminRouter.patch('/restaurants/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const input = parse(z.object({ sponsored: z.boolean().optional(), commissionBps: z.number().int().min(0).max(5000).nullable().optional() }), req.body);
  const before = await RestaurantModel.findByIdAndUpdate(id, { $set: input }).lean();
  if (!before) throw notFound('Restaurant');
  await audit(req, 'restaurant.update', 'Restaurant', id, { before: { sponsored: before.sponsored, commissionBps: before.commissionBps }, after: input });
  res.json({ ok: true });
});

adminRouter.get('/partners', async (req, res) => {
  const f = parse(page.extend({ approval: z.enum(APPROVAL_STATUSES).optional() }), req.query);
  const list = await PartnerProfileModel.find(f.approval ? { approval: f.approval } : {})
    .sort({ createdAt: -1 })
    .skip((f.page - 1) * PAGE)
    .limit(PAGE)
    .populate<{ userId: { _id: unknown; name: string; email: string; phone: string } }>('userId', 'name email phone')
    .lean();
  res.json({
    partners: list.map((p) => ({
      userId: String(p.userId?._id),
      name: p.userId?.name,
      email: p.userId?.email,
      phone: maskPhone(p.userId?.phone),
      vehicle: p.vehicle,
      vehicleNumber: p.vehicleNumber,
      city: p.city,
      approval: p.approval,
      online: p.online,
      busy: Boolean(p.currentOrderId),
      createdAt: p.createdAt,
    })),
  });
});

adminRouter.post('/partners/:userId/approval', async (req, res) => {
  const userId = parse(objectId, req.params.userId);
  const { approval, note } = parse(z.object({ approval: z.enum(APPROVAL_STATUSES), note: z.string().trim().max(200).default('') }), req.body);
  const before = await PartnerProfileModel.findOneAndUpdate(
    { userId },
    { $set: { approval, ...(approval !== 'APPROVED' ? { online: false } : {}) } },
  ).lean();
  if (!before) throw notFound('Partner');
  await audit(req, 'partner.approval', 'PartnerProfile', userId, { before: before.approval, after: approval, note });
  res.json({ approval });
});

// ── Orders ───────────────────────────────────────────────────────────────────

adminRouter.get('/orders', async (req, res) => {
  const f = parse(page.extend({ status: z.enum(ORDER_STATUSES).optional(), q: z.string().trim().max(20).optional() }), req.query);
  const filter: Record<string, unknown> = {};
  if (f.status) filter.status = f.status;
  if (f.q) filter.orderNumber = new RegExp(escapeRegex(f.q.toUpperCase()));
  const list = await OrderModel.find(filter).sort({ createdAt: -1 }).skip((f.page - 1) * PAGE).limit(PAGE).lean();
  res.json({
    orders: list.map((o) => ({
      id: String(o._id),
      orderNumber: o.orderNumber,
      status: o.status,
      restaurant: o.restaurantSnapshot?.name,
      customer: o.contactName,
      total: o.pricing?.total,
      refundStatus: o.refundStatus,
      supportStatus: o.supportStatus,
      createdAt: o.createdAt,
    })),
  });
});

adminRouter.get('/orders/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const order = await OrderModel.findById(id);
  if (!order) throw notFound('Order');
  const [payments, refunds, notifications, auditLogs] = await Promise.all([
    PaymentModel.find({ orderId: id }).sort({ attempt: 1 }).lean(),
    RefundModel.find({ orderId: id }).sort({ createdAt: 1 }).lean(),
    NotificationModel.find({ orderId: id }).sort({ createdAt: 1 }).lean(),
    AuditLogModel.find({ targetType: 'Order', targetId: id }).sort({ createdAt: 1 }).lean(),
  ]);
  res.json({
    order: await serializeOrder(order, 'admin'),
    payments: payments.map((p) => ({ id: String(p._id), attempt: p.attempt, provider: p.provider, status: p.status, amount: p.amount, refundedAmount: p.refundedAmount, failureReason: p.failureReason, events: p.events, createdAt: p.createdAt })),
    refunds: refunds.map((r) => ({ id: String(r._id), amount: r.amount, status: r.status, kind: r.kind, reason: r.reason, details: r.details, failureReason: r.failureReason, createdAt: r.createdAt })),
    notifications: notifications.map((n) => ({ id: String(n._id), event: n.event, status: n.status, to: maskPhone(n.to), body: n.body, attempts: n.attempts, lastError: n.lastError, createdAt: n.createdAt })),
    audit: auditLogs,
  });
});

adminRouter.post('/orders/:id/cancel', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  await adminCancel(id, reason);
  await audit(req, 'order.cancel', 'Order', id, { reason });
  res.json({ ok: true });
});

adminRouter.post('/orders/:id/reassign', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { note } = parse(z.object({ note: z.string().trim().max(200).default('Reassigned by admin') }), req.body);
  await reassign(id, note);
  await audit(req, 'order.reassign', 'Order', id, { note });
  res.json({ ok: true, assignment: await AssignmentModel.findOne({ orderId: id }).select('status partnerId').lean() });
});

// ── Refunds ──────────────────────────────────────────────────────────────────

adminRouter.get('/refunds', async (req, res) => {
  const f = parse(page.extend({ status: z.enum(['REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'REJECTED', 'FAILED']).optional() }), req.query);
  const list = await RefundModel.find(f.status ? { status: f.status } : {}).sort({ createdAt: -1 }).skip((f.page - 1) * PAGE).limit(PAGE).lean();
  const orders = await OrderModel.find({ _id: { $in: list.map((r) => r.orderId) } }).select('orderNumber pricing.total refundedAmount').lean();
  const byId = new Map(orders.map((o) => [String(o._id), o]));
  res.json({
    refunds: list.map((r) => ({
      id: String(r._id),
      orderId: String(r.orderId),
      orderNumber: byId.get(String(r.orderId))?.orderNumber,
      orderTotal: byId.get(String(r.orderId))?.pricing?.total,
      amount: r.amount,
      status: r.status,
      kind: r.kind,
      reason: r.reason,
      details: r.details,
      failureReason: r.failureReason,
      createdAt: r.createdAt,
    })),
  });
});

adminRouter.post('/refunds/:id/:decision', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const decision = parse(z.enum(['approve', 'reject', 'retry']), req.params.decision);
  const { amount, note } = parse(z.object({ amount: z.number().int().min(1).optional(), note: z.string().trim().max(200).default('') }), req.body);
  const refund = await RefundModel.findById(id);
  if (!refund) throw notFound('Refund');
  if (decision === 'reject') {
    if (refund.status !== 'REQUESTED') throw conflict('REFUND_STATE', 'Only open requests can be rejected.');
    refund.status = 'REJECTED';
    refund.decidedBy = currentUser(req).id as never;
    refund.decisionNote = note;
    await refund.save();
    await OrderModel.updateOne({ _id: refund.orderId }, { $set: { supportStatus: 'RESOLVED' } });
  } else {
    if (decision === 'approve' && refund.status !== 'REQUESTED') throw conflict('REFUND_STATE', 'Only open requests can be approved.');
    if (decision === 'retry' && refund.status !== 'FAILED') throw conflict('REFUND_STATE', 'Only failed refunds can be retried.');
    refund.decisionNote = note;
    await refund.save();
    await issueRefund({
      orderId: String(refund.orderId),
      amount: amount ?? refund.amount,
      reason: refund.reason,
      kind: refund.kind,
      refundId: id,
      decidedBy: currentUser(req).id,
    });
    await OrderModel.updateOne({ _id: refund.orderId }, { $set: { supportStatus: 'RESOLVED' } });
  }
  await audit(req, `refund.${decision}`, 'Order', String(refund.orderId), { refundId: id, amount: amount ?? refund.amount, note });
  res.json({ refund: await RefundModel.findById(id).lean() });
});

// ── Promotions, zones, pricing config ───────────────────────────────────────

adminRouter.get('/coupons', async (_req, res) => {
  const list = await CouponModel.find().sort({ createdAt: -1 }).lean();
  res.json({ coupons: list.map(({ _id, ...c }) => ({ ...c, id: String(_id) })) });
});

adminRouter.post('/coupons', async (req, res) => {
  const input = parse(couponSchema, req.body);
  if (input.validTo <= input.validFrom) throw badRequest('End date must be after start date');
  if (input.type === 'percent' && input.value > 10000) throw badRequest('Percent value is in basis points (max 10000)');
  const c = await CouponModel.create(input);
  await audit(req, 'coupon.create', 'Coupon', String(c._id), input);
  res.status(201).json({ coupon: { id: String(c._id) } });
});

adminRouter.put('/coupons/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const input = parse(couponSchema, req.body);
  const before = await CouponModel.findByIdAndUpdate(id, { $set: input }).lean();
  if (!before) throw notFound('Coupon');
  await audit(req, 'coupon.update', 'Coupon', id, { before, after: input });
  res.json({ ok: true });
});

adminRouter.get('/zones', async (_req, res) => {
  const list = await ZoneModel.find().sort({ city: 1, name: 1 }).lean();
  res.json({ zones: list.map((z) => ({ id: String(z._id), name: z.name, city: z.city, center: fromPoint(z.center), radiusKm: z.radiusKm, active: z.active })) });
});

adminRouter.post('/zones', async (req, res) => {
  const input = parse(zoneSchema, req.body);
  const z1 = await ZoneModel.create({ ...input, center: toPoint(input.center) });
  await audit(req, 'zone.create', 'Zone', String(z1._id), input);
  res.status(201).json({ zone: { id: String(z1._id) } });
});

adminRouter.put('/zones/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const input = parse(zoneSchema, req.body);
  const before = await ZoneModel.findByIdAndUpdate(id, { $set: { ...input, center: toPoint(input.center) } }).lean();
  if (!before) throw notFound('Zone');
  await audit(req, 'zone.update', 'Zone', id, { after: input });
  res.json({ ok: true });
});

adminRouter.get('/config/pricing', async (_req, res) => {
  res.json({ pricing: await getPricingConfig() });
});

adminRouter.put('/config/pricing', async (req, res) => {
  const input = parse(pricingConfigSchema, req.body);
  const before = await getPricingConfig();
  const pricing = await setPricingConfig(input);
  await audit(req, 'config.pricing', 'PlatformConfig', 'pricing', { before, after: input });
  res.json({ pricing });
});

// ── Reviews ──────────────────────────────────────────────────────────────────

adminRouter.get('/reviews', async (req, res) => {
  const f = parse(page.extend({ hidden: z.enum(['true', 'false']).optional() }), req.query);
  const list = await ReviewModel.find(f.hidden ? { hidden: f.hidden === 'true' } : {}).sort({ createdAt: -1 }).skip((f.page - 1) * PAGE).limit(PAGE).lean();
  const rs = await RestaurantModel.find({ _id: { $in: list.map((r) => r.restaurantId) } }).select('name').lean();
  const names = new Map(rs.map((r) => [String(r._id), r.name]));
  res.json({ reviews: list.map(({ _id, ...r }) => ({ ...r, id: String(_id), restaurant: names.get(String(r.restaurantId)) })) });
});

adminRouter.patch('/reviews/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { hidden, reason } = parse(z.object({ hidden: z.boolean(), reason: z.string().trim().max(200).default('') }), req.body);
  await withTransaction(async (session) => {
    const review = await ReviewModel.findById(id).session(session);
    if (!review) throw notFound('Review');
    review.hidden = hidden;
    review.hiddenReason = reason;
    await review.save({ session });
    // Recompute the rating from visible reviews so moderation is reflected immediately.
    const agg = await ReviewModel.aggregate([
      { $match: { restaurantId: review.restaurantId, hidden: false } },
      { $group: { _id: null, avg: { $avg: '$foodRating' }, count: { $sum: 1 } } },
    ]).session(session);
    await RestaurantModel.updateOne(
      { _id: review.restaurantId },
      { $set: { rating: { avg: Math.round((agg[0]?.avg ?? 0) * 10) / 10, count: agg[0]?.count ?? 0 } } },
      { session },
    );
    await audit(req, hidden ? 'review.hide' : 'review.unhide', 'Review', id, { reason }, session);
  });
  res.json({ ok: true });
});

// ── Notifications outbox ─────────────────────────────────────────────────────

adminRouter.get('/notifications', async (req, res) => {
  const f = parse(page.extend({ status: z.string().max(20).optional() }), req.query);
  const list = await NotificationModel.find(f.status ? { status: f.status } : {}).sort({ createdAt: -1 }).skip((f.page - 1) * PAGE).limit(PAGE).lean();
  res.json({
    notifications: list.map((n) => ({
      id: String(n._id),
      orderId: n.orderId ? String(n.orderId) : null,
      event: n.event,
      to: maskPhone(n.to),
      body: n.body,
      status: n.status,
      provider: n.provider,
      attempts: n.attempts,
      lastError: n.lastError,
      createdAt: n.createdAt,
    })),
  });
});

adminRouter.post('/notifications/:id/retry', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const r = await NotificationModel.updateOne(
    { _id: id, status: { $in: ['FAILED', 'UNDELIVERED'] } },
    { $set: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: '' } },
  );
  if (!r.modifiedCount) throw conflict('NOT_RETRYABLE', 'Only failed notifications can be retried.');
  await audit(req, 'notification.retry', 'Notification', id);
  res.json({ ok: true });
});

// ── Audit log & payouts ──────────────────────────────────────────────────────

adminRouter.get('/audit', async (req, res) => {
  const f = parse(page, req.query);
  const logs = await AuditLogModel.find().sort({ createdAt: -1 }).skip((f.page - 1) * PAGE).limit(PAGE).populate<{ actorId: { name: string } | null }>('actorId', 'name').lean();
  res.json({ logs: logs.map((l) => ({ id: String(l._id), actor: l.actorId?.name ?? 'system', actorRole: l.actorRole, action: l.action, targetType: l.targetType, targetId: l.targetId, changes: l.changes, createdAt: l.createdAt })) });
});

adminRouter.post('/payouts/generate', async (req, res) => {
  const { periodStart, periodEnd } = parse(z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date() }), req.body);
  if (periodEnd <= periodStart) throw badRequest('periodEnd must be after periodStart');
  const rows = await OrderModel.aggregate([
    { $match: { status: 'DELIVERED', deliveredAt: { $gte: periodStart, $lt: periodEnd } } },
    {
      $group: {
        _id: '$restaurantId',
        orders: { $sum: 1 },
        itemTotal: { $sum: '$pricing.itemTotal' },
        packaging: { $sum: '$pricing.packagingFee' },
        commission: { $sum: '$commission.amount' },
        gst: { $sum: '$commission.gst' },
      },
    },
  ]);
  let created = 0;
  for (const r of rows) {
    const u = await PayoutModel.updateOne(
      { restaurantId: r._id, periodStart, periodEnd },
      {
        $setOnInsert: {
          orders: r.orders,
          itemTotal: r.itemTotal,
          packaging: r.packaging,
          commission: r.commission,
          gstOnCommission: r.gst,
          refundsAbsorbed: 0,
          net: r.itemTotal + r.packaging - r.commission - r.gst,
          status: 'GENERATED',
        },
      },
      { upsert: true },
    );
    created += u.upsertedCount;
  }
  await audit(req, 'payout.generate', 'Payout', `${periodStart.toISOString()}..${periodEnd.toISOString()}`, { restaurants: rows.length, created });
  res.json({ restaurants: rows.length, created });
});

adminRouter.get('/payouts', async (_req, res) => {
  const list = await PayoutModel.find().sort({ periodStart: -1 }).limit(100).populate<{ restaurantId: { name: string } }>('restaurantId', 'name').lean();
  res.json({ payouts: list.map(({ _id, restaurantId, ...p }) => ({ ...p, id: String(_id), restaurant: restaurantId?.name })) });
});

adminRouter.post('/payouts/:id/mark-paid', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const r = await PayoutModel.updateOne({ _id: id, status: 'GENERATED' }, { $set: { status: 'PAID' } });
  if (!r.modifiedCount) throw conflict('PAYOUT_STATE', 'Payout is already marked paid.');
  await audit(req, 'payout.mark_paid', 'Payout', id);
  emit(rooms.admin, 'admin:refresh', { type: 'payout' });
  res.json({ ok: true });
});
