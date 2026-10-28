import type { ClientSession, Types } from 'mongoose';
import { haversineKm, locationUpdateSchema, type LocationUpdateInput } from '@tadka/shared';
import { env } from '../../config/env';
import { AppError, conflict, notFound } from '../../lib/errors';
import { withTransaction } from '../../lib/db';
import { logger } from '../../lib/logger';
import { fromPoint, toPoint } from '../../models/common';
import { OrderModel, type OrderDoc } from '../../models/order';
import { AssignmentModel, LocationUpdateModel } from '../../models/ops';
import { PartnerProfileModel } from '../../models/user';
import { emit, rooms } from '../../realtime/io';
import { applyTransition, broadcastOrder, notifyCustomer, refreshEta } from '../orders/orders.service';

export const OFFER_TTL_MS = 60_000;
const MAX_PARTNER_RADIUS_M = 8000;
const PARTNER_LOCATION_FRESH_MS = 15 * 60_000;
export const STALE_LOCATION_MS = 45_000;
const EARNING_BASE = 2500;
const EARNING_PER_KM = 800;

export async function createAssignment(order: OrderDoc, session: ClientSession) {
  await AssignmentModel.updateOne(
    { orderId: order._id },
    {
      $setOnInsert: {
        orderId: order._id,
        restaurantId: order.restaurantId,
        status: 'SEARCHING',
        distanceKm: order.distanceKm,
        history: [{ status: 'SEARCHING', at: new Date(), note: 'Looking for a delivery partner' }],
      },
    },
    { upsert: true, session },
  );
}

/** Offers the order to the nearest free, approved, online partner who hasn't declined it. */
export async function offerNextPartner(orderId: string): Promise<boolean> {
  const a = await AssignmentModel.findOne({ orderId, status: 'SEARCHING' }).lean();
  if (!a) return false;
  const order = await OrderModel.findById(orderId).select('restaurantSnapshot status').lean();
  if (!order || !['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'].includes(order.status)) return false;
  const near = fromPoint(order.restaurantSnapshot?.location as never);
  if (!near) return false;

  const candidates = await PartnerProfileModel.find({
    approval: 'APPROVED',
    online: true,
    currentOrderId: null,
    userId: { $nin: a.declinedPartnerIds },
    locationAt: { $gte: new Date(Date.now() - PARTNER_LOCATION_FRESH_MS) },
    location: { $near: { $geometry: toPoint(near), $maxDistance: MAX_PARTNER_RADIUS_M } },
  })
    .limit(5)
    .lean();
  for (const c of candidates) {
    // Skip partners already holding a live offer for another order.
    if (await AssignmentModel.exists({ partnerId: c.userId, status: 'OFFERED', offerExpiresAt: { $gt: new Date() } })) continue;
    const now = new Date();
    const updated = await AssignmentModel.findOneAndUpdate(
      { _id: a._id, status: 'SEARCHING' },
      {
        $set: { status: 'OFFERED', partnerId: c.userId, offeredAt: now, offerExpiresAt: new Date(now.getTime() + OFFER_TTL_MS) },
        $push: { history: { status: 'OFFERED', partnerId: c.userId, at: now } },
      },
      { new: true },
    );
    if (updated) {
      emit(rooms.partner(String(c.userId)), 'delivery:offer', { orderId, expiresAt: updated.offerExpiresAt });
      return true;
    }
  }
  return false;
}

export async function respondToOffer(partnerUserId: string, orderId: string, accept: boolean) {
  if (!accept) {
    const a = await AssignmentModel.findOneAndUpdate(
      { orderId, partnerId: partnerUserId, status: 'OFFERED' },
      {
        $set: { status: 'SEARCHING', partnerId: null, offeredAt: null, offerExpiresAt: null },
        $push: { declinedPartnerIds: partnerUserId, history: { status: 'DECLINED', partnerId: partnerUserId, at: new Date() } },
      },
    );
    if (!a) throw notFound('Offer');
    await offerNextPartner(orderId);
    return null;
  }
  const order = await withTransaction(async (session) => {
    const profile = await PartnerProfileModel.findOneAndUpdate(
      { userId: partnerUserId, approval: 'APPROVED', currentOrderId: null },
      { $set: { currentOrderId: orderId } },
      { new: true, session },
    );
    if (!profile) throw conflict('PARTNER_BUSY', 'Finish your current delivery before accepting another.');
    const a = await AssignmentModel.findOneAndUpdate(
      { orderId, partnerId: partnerUserId, status: 'OFFERED', offerExpiresAt: { $gt: new Date() } },
      { $set: { status: 'ACCEPTED', acceptedAt: new Date() }, $push: { history: { status: 'ACCEPTED', partnerId: partnerUserId, at: new Date() } } },
      { new: true, session },
    );
    if (!a) throw new AppError(410, 'OFFER_EXPIRED', 'This offer has expired or was reassigned.');
    const order = await OrderModel.findById(orderId).select('+deliveryOtp').session(session);
    if (!order) throw notFound('Order');
    order.partnerId = profile.userId as Types.ObjectId;
    await order.save({ session });
    await notifyCustomer(order, 'PARTNER_ASSIGNED', session);
    return order;
  });
  broadcastOrder(order);
  return order;
}

/** After a status change, prefer the partner's live position (if fresh) over the speed-model fallback. */
function useFreshLocation(order: OrderDoc, loc: { lat?: number | null; lng?: number | null; at?: Date | null } | null | undefined, reason: string) {
  if (loc?.at && loc.lat != null && loc.lng != null && Date.now() - new Date(loc.at).getTime() < STALE_LOCATION_MS)
    refreshEta(order, reason, { partnerLocation: { lat: loc.lat, lng: loc.lng } });
}

async function loadActive(partnerUserId: string, orderId: string, session: ClientSession) {
  const a = await AssignmentModel.findOne({ orderId, partnerId: partnerUserId, status: { $in: ['ACCEPTED', 'PICKED_UP'] } }).session(session);
  if (!a) throw notFound('Active delivery');
  const order = await OrderModel.findById(orderId).select('+deliveryOtp').session(session);
  if (!order) throw notFound('Order');
  return { a, order };
}

export async function markPickedUp(partnerUserId: string, orderId: string) {
  const order = await withTransaction(async (session) => {
    const { a, order } = await loadActive(partnerUserId, orderId, session);
    applyTransition(order, 'PICKED_UP', 'delivery', 'Partner collected the order');
    useFreshLocation(order, a.lastLocation, 'Partner collected the order');
    a.status = 'PICKED_UP';
    a.pickedUpAt = new Date();
    a.history.push({ status: 'PICKED_UP', partnerId: a.partnerId, at: new Date() });
    await Promise.all([order.save({ session }), a.save({ session })]);
    await notifyCustomer(order, 'ORDER_PICKED_UP', session);
    return order;
  });
  broadcastOrder(order);
  return order;
}

export async function markOutForDelivery(partnerUserId: string, orderId: string) {
  const order = await withTransaction(async (session) => {
    const { a, order } = await loadActive(partnerUserId, orderId, session);
    applyTransition(order, 'OUT_FOR_DELIVERY', 'delivery', 'Heading to the customer');
    useFreshLocation(order, a.lastLocation, 'Heading to the customer');
    await order.save({ session });
    return order;
  });
  broadcastOrder(order);
  return order;
}

export async function markDelivered(partnerUserId: string, orderId: string, otp: string) {
  const order = await withTransaction(async (session) => {
    const { a, order } = await loadActive(partnerUserId, orderId, session);
    if (order.get('deliveryOtp') !== otp) throw new AppError(422, 'OTP_MISMATCH', 'That OTP does not match. Ask the customer to check the app.');
    applyTransition(order, 'DELIVERED', 'delivery', 'Delivered with OTP verification');
    const distancePay = Math.round(a.distanceKm * EARNING_PER_KM);
    a.status = 'DELIVERED';
    a.deliveredAt = new Date();
    a.earnings = { base: EARNING_BASE, distancePay, total: EARNING_BASE + distancePay };
    a.history.push({ status: 'DELIVERED', partnerId: a.partnerId, at: new Date() });
    await Promise.all([order.save({ session }), a.save({ session })]);
    await PartnerProfileModel.updateOne({ userId: partnerUserId }, { $set: { currentOrderId: null } }, { session });
    await notifyCustomer(order, 'ORDER_DELIVERED', session);
    return order;
  });
  broadcastOrder(order);
  return order;
}

/** Ends an assignment when an order is cancelled/rejected; frees the partner. */
export async function releaseAssignment(orderId: Types.ObjectId | string, session: ClientSession) {
  const a = await AssignmentModel.findOne({ orderId, status: { $in: ['SEARCHING', 'OFFERED', 'ACCEPTED', 'PICKED_UP'] } }).session(session);
  if (!a) return;
  if (a.partnerId) await PartnerProfileModel.updateOne({ userId: a.partnerId, currentOrderId: orderId }, { $set: { currentOrderId: null } }, { session });
  a.status = 'CANCELLED';
  a.history.push({ status: 'CANCELLED', partnerId: a.partnerId, at: new Date(), note: 'Order cancelled' });
  await a.save({ session });
  if (a.partnerId) emit(rooms.partner(String(a.partnerId)), 'delivery:cancelled', { orderId: String(orderId) });
}

/** Admin reassignment: returns the order to the dispatch pool, excluding the current partner. */
export async function reassign(orderId: string, note: string) {
  await withTransaction(async (session) => {
    const a = await AssignmentModel.findOne({ orderId, status: { $in: ['OFFERED', 'ACCEPTED'] } }).session(session);
    if (!a) throw conflict('NOT_REASSIGNABLE', 'Only offered or accepted (not yet picked up) deliveries can be reassigned.');
    const prev = a.partnerId;
    if (prev) {
      await PartnerProfileModel.updateOne({ userId: prev, currentOrderId: a.orderId }, { $set: { currentOrderId: null } }, { session });
      a.declinedPartnerIds.push(prev);
    }
    a.status = 'SEARCHING';
    a.partnerId = null;
    a.lastLocation = null;
    a.history.push({ status: 'REASSIGNED', partnerId: prev, at: new Date(), note });
    await a.save({ session });
    await OrderModel.updateOne({ _id: orderId }, { $set: { partnerId: null } }, { session });
    if (prev) emit(rooms.partner(String(prev)), 'delivery:cancelled', { orderId });
  });
  await offerNextPartner(orderId);
}

/** Housekeeping: expire unanswered offers and retry dispatch for unassigned orders. */
export async function runDispatchCycle() {
  const expired = await AssignmentModel.find({ status: 'OFFERED', offerExpiresAt: { $lt: new Date() } }).limit(50);
  for (const a of expired) {
    const r = await AssignmentModel.updateOne(
      { _id: a._id, status: 'OFFERED' },
      {
        $set: { status: 'SEARCHING', partnerId: null, offerExpiresAt: null },
        $push: { declinedPartnerIds: a.partnerId, history: { status: 'EXPIRED', partnerId: a.partnerId, at: new Date() } },
      },
    );
    if (r.modifiedCount && a.partnerId) emit(rooms.partner(String(a.partnerId)), 'delivery:cancelled', { orderId: String(a.orderId) });
  }
  const searching = await AssignmentModel.find({ status: 'SEARCHING' }).select('orderId').limit(50).lean();
  for (const s of searching) await offerNextPartner(String(s.orderId));
}

// ── Location ─────────────────────────────────────────────────────────────────

const lastAccepted = new Map<string, number>();
const MIN_INTERVAL_MS = 2000;
const MAX_SPEED_KMPH = 120;

export type LocationResult = { accepted: true } | { accepted: false; reason: string };

/**
 * Validates and stores a partner location ping for an active delivery and fans it out to the order room.
 * Only the assigned partner, only while the delivery is active, only plausible and fresh readings.
 */
export async function handleLocationUpdate(partnerUserId: string, raw: LocationUpdateInput): Promise<LocationResult> {
  const parsed = locationUpdateSchema.safeParse(raw);
  if (!parsed.success) return { accepted: false, reason: 'invalid_payload' };
  const u = parsed.data;
  if (u.source === 'demo' && !env.ALLOW_DEMO_LOCATION) return { accepted: false, reason: 'demo_disabled' };

  const now = Date.now();
  if (u.recordedAt > now + 30_000 || u.recordedAt < now - 120_000) return { accepted: false, reason: 'stale_or_future_timestamp' };
  if ((u.accuracy ?? 0) > 500) return { accepted: false, reason: 'low_accuracy' };
  const a = await AssignmentModel.findOne({ orderId: u.orderId, partnerId: partnerUserId, status: { $in: ['ACCEPTED', 'PICKED_UP'] } });
  if (!a) return { accepted: false, reason: 'not_assigned' };
  const key = `${partnerUserId}:${u.orderId}`;
  if (now - (lastAccepted.get(key) ?? 0) < MIN_INTERVAL_MS) return { accepted: false, reason: 'throttled' };

  const prev = a.lastLocation;
  if (prev?.at && prev.lat != null && prev.lng != null && u.source === 'gps') {
    const hours = (u.recordedAt - new Date(prev.at).getTime()) / 3_600_000;
    if (hours > 0 && haversineKm({ lat: prev.lat, lng: prev.lng }, u) / hours > MAX_SPEED_KMPH)
      return { accepted: false, reason: 'implausible_jump' };
  }

  lastAccepted.set(key, now);
  const at = new Date(u.recordedAt);
  a.lastLocation = { lat: u.lat, lng: u.lng, accuracy: u.accuracy ?? 0, at, source: u.source };
  await a.save();
  await Promise.all([
    LocationUpdateModel.create({ orderId: u.orderId, partnerId: partnerUserId, location: toPoint(u), accuracy: u.accuracy, source: u.source, recordedAt: at }),
    PartnerProfileModel.updateOne({ userId: partnerUserId }, { $set: { location: toPoint(u), locationAt: at } }),
  ]);

  // Refresh the ETA from live position at most every 20s to avoid churning writes — but always upgrade
  // immediately when the current estimate was made without live data.
  const order = await OrderModel.findById(u.orderId);
  const liveLeg = order && ['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(order.status);
  if (
    order &&
    (!order.eta?.computedAt ||
      now - new Date(order.eta.computedAt).getTime() > 20_000 ||
      (liveLeg && order.eta.confidence !== 'high'))
  ) {
    refreshEta(order, 'Partner location updated', { partnerLocation: { lat: u.lat, lng: u.lng } });
    await order.save().catch((err) => logger.warn({ err: (err as Error).message }, 'ETA save failed'));
  }

  emit(rooms.order(u.orderId), 'order:location', {
    orderId: u.orderId,
    lat: u.lat,
    lng: u.lng,
    accuracy: u.accuracy ?? null,
    at: at.toISOString(),
    source: u.source,
    eta: order?.eta ?? null,
  });
  return { accepted: true };
}

/** Idle heartbeat while online (no active delivery): updates dispatch position only; no history kept. */
export async function updateIdleLocation(partnerUserId: string, p: { lat: number; lng: number }) {
  await PartnerProfileModel.updateOne({ userId: partnerUserId, online: true }, { $set: { location: toPoint(p), locationAt: new Date() } });
}
