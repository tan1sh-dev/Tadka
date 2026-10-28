import { Router } from 'express';
import { z } from 'zod';
import { latLngSchema, objectId } from '@tadka/shared';
import { env } from '../../config/env';
import { AppError, notFound, parse } from '../../lib/errors';
import { currentUser, requireRole } from '../../middleware/auth';
import { locationLimiter } from '../../middleware/security';
import { OrderModel } from '../../models/order';
import { AssignmentModel } from '../../models/ops';
import { PartnerProfileModel } from '../../models/user';
import { serializeOrder } from '../orders/orders.service';
import {
  handleLocationUpdate,
  markDelivered,
  markOutForDelivery,
  markPickedUp,
  offerNextPartner,
  respondToOffer,
  updateIdleLocation,
} from './delivery.service';

export const deliveryRouter = Router();
deliveryRouter.use(requireRole('delivery'));

async function requireApproved(userId: string) {
  const p = await PartnerProfileModel.findOne({ userId }).lean();
  if (!p) throw notFound('Partner profile');
  if (p.approval !== 'APPROVED') throw new AppError(403, 'NOT_APPROVED', 'Your partner account is awaiting approval.');
  return p;
}

deliveryRouter.get('/me', async (req, res) => {
  const me = currentUser(req);
  const p = await PartnerProfileModel.findOne({ userId: me.id }).lean();
  if (!p) throw notFound('Partner profile');
  const [offers, active] = await Promise.all([
    AssignmentModel.find({ partnerId: me.id, status: 'OFFERED', offerExpiresAt: { $gt: new Date() } }).lean(),
    AssignmentModel.findOne({ partnerId: me.id, status: { $in: ['ACCEPTED', 'PICKED_UP'] } }).lean(),
  ]);
  const offerOrders = await Promise.all(
    offers.map(async (o) => {
      const order = await OrderModel.findById(o.orderId).lean();
      return order && {
        orderId: String(o.orderId),
        expiresAt: o.offerExpiresAt,
        restaurant: order.restaurantSnapshot?.name,
        pickupLocality: order.restaurantSnapshot?.locality,
        dropLocality: order.deliveryAddress?.locality,
        distanceKm: o.distanceKm,
        estimatedEarnings: 2500 + Math.round(o.distanceKm * 800),
        items: order.items.reduce((s, i) => s + i.quantity, 0),
      };
    }),
  );
  const activeOrder = active ? await OrderModel.findById(active.orderId) : null;
  res.json({
    profile: { approval: p.approval, online: p.online, vehicle: p.vehicle, vehicleNumber: p.vehicleNumber, city: p.city },
    offers: offerOrders.filter(Boolean),
    active: activeOrder ? await serializeOrder(activeOrder, 'delivery') : null,
    demoLocationAllowed: env.ALLOW_DEMO_LOCATION,
  });
});

deliveryRouter.patch('/me', async (req, res) => {
  const input = parse(
    z.object({ vehicle: z.enum(['bicycle', 'scooter', 'motorcycle', 'ev_scooter']), vehicleNumber: z.string().trim().max(15).default('') }),
    req.body,
  );
  await PartnerProfileModel.updateOne({ userId: currentUser(req).id }, { $set: input });
  res.json({ ok: true });
});

deliveryRouter.post('/availability', async (req, res) => {
  const me = currentUser(req);
  const { online, location } = parse(z.object({ online: z.boolean(), location: latLngSchema.optional() }), req.body);
  const p = await requireApproved(me.id);
  if (!online && p.currentOrderId) throw new AppError(409, 'ACTIVE_DELIVERY', 'Complete your active delivery before going offline.');
  if (online && !location) throw new AppError(422, 'LOCATION_REQUIRED', 'Share your location to receive nearby orders.');
  await PartnerProfileModel.updateOne(
    { userId: me.id },
    online ? { $set: { online, location: { type: 'Point', coordinates: [location!.lng, location!.lat] }, locationAt: new Date() } } : { $set: { online } },
  );
  if (online) {
    // A partner coming online may be the one a waiting order needs.
    const waiting = await AssignmentModel.find({ status: 'SEARCHING' }).select('orderId').limit(10).lean();
    for (const w of waiting) await offerNextPartner(String(w.orderId));
  }
  res.json({ online });
});

deliveryRouter.post('/heartbeat', locationLimiter, async (req, res) => {
  await updateIdleLocation(currentUser(req).id, parse(latLngSchema, req.body));
  res.json({ ok: true });
});

deliveryRouter.post('/offers/:orderId/:action', async (req, res) => {
  const orderId = parse(objectId, req.params.orderId);
  const action = parse(z.enum(['accept', 'decline']), req.params.action);
  await requireApproved(currentUser(req).id);
  const order = await respondToOffer(currentUser(req).id, orderId, action === 'accept');
  res.json({ ok: true, order: order ? await serializeOrder(order, 'delivery') : null });
});

deliveryRouter.post('/orders/:orderId/:step', async (req, res) => {
  const orderId = parse(objectId, req.params.orderId);
  const step = parse(z.enum(['pickup', 'start', 'deliver']), req.params.step);
  const me = currentUser(req).id;
  const order =
    step === 'pickup'
      ? await markPickedUp(me, orderId)
      : step === 'start'
        ? await markOutForDelivery(me, orderId)
        : await markDelivered(me, orderId, parse(z.object({ otp: z.string().regex(/^\d{4}$/, 'Enter the 4-digit OTP') }), req.body).otp);
  res.json({ order: await serializeOrder(order, 'delivery') });
});

/** REST fallback for location pings (Socket.IO is primary). */
deliveryRouter.post('/location', locationLimiter, async (req, res) => {
  const r = await handleLocationUpdate(currentUser(req).id, req.body);
  res.status(r.accepted ? 200 : 422).json(r);
});

deliveryRouter.get('/history', async (req, res) => {
  const me = currentUser(req).id;
  const list = await AssignmentModel.find({ partnerId: me, status: 'DELIVERED' }).sort({ deliveredAt: -1 }).limit(50).lean();
  const orders = await OrderModel.find({ _id: { $in: list.map((l) => l.orderId) } })
    .select('orderNumber restaurantSnapshot.name deliveryAddress.locality')
    .lean();
  const byId = new Map(orders.map((o) => [String(o._id), o]));
  const since = new Date(Date.now() - 7 * 86400_000);
  res.json({
    deliveries: list.map((a) => ({
      orderId: String(a.orderId),
      orderNumber: byId.get(String(a.orderId))?.orderNumber,
      restaurant: byId.get(String(a.orderId))?.restaurantSnapshot?.name,
      dropLocality: byId.get(String(a.orderId))?.deliveryAddress?.locality,
      distanceKm: a.distanceKm,
      earnings: a.earnings,
      deliveredAt: a.deliveredAt,
      durationMin: a.acceptedAt && a.deliveredAt ? Math.round((+a.deliveredAt - +a.acceptedAt) / 60000) : null,
    })),
    summary: {
      lifetime: list.reduce((s, a) => s + (a.earnings?.total ?? 0), 0),
      last7Days: list.filter((a) => a.deliveredAt && a.deliveredAt >= since).reduce((s, a) => s + (a.earnings?.total ?? 0), 0),
      count: list.length,
    },
  });
});
