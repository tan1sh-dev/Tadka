import crypto from 'node:crypto';
import type { ClientSession } from 'mongoose';
import {
  STATUS_LABELS,
  assertTransition,
  commissionFor,
  estimateEta,
  haversineKm,
  type Actor,
  type CreateOrderInput,
  type DietaryProfile,
  type NotificationEvent,
  type OrderStatus,
} from '@tadka/shared';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors';
import { withTransaction } from '../../lib/db';
import { fromPoint } from '../../models/common';
import { OrderModel, PaymentModel, type OrderDoc } from '../../models/order';
import { AddressModel, UserModel } from '../../models/user';
import { RestaurantModel } from '../../models/restaurant';
import { AssignmentModel } from '../../models/ops';
import { emit, rooms } from '../../realtime/io';
import { getPricingConfig } from '../../services/config';
import { routeMinutes } from '../../services/geo';
import { enqueueSms } from '../notifications/notifications.service';
import { getPaymentProvider } from '../payments/payment.provider';
import { buildServerQuote } from './quote.service';
import type { AuthUser } from '../../middleware/auth';
import { createAssignment, offerNextPartner, releaseAssignment } from '../delivery/delivery.service';
import { issueRefund } from '../payments/refunds.service';

export function generateOrderNumber(): string {
  return `TDK-${crypto.randomBytes(4).readUInt32BE(0).toString(36).toUpperCase().padStart(6, '0').slice(-6)}`;
}

/** Recomputes the explained ETA range for an order. */
export function refreshEta(order: OrderDoc, reason: string, live?: { partnerLocation?: { lat: number; lng: number } | null }) {
  const restaurantLoc = fromPoint(order.restaurantSnapshot?.location as never);
  const customerLoc = fromPoint(order.deliveryAddress?.location as never);
  if (!restaurantLoc || !customerLoc) return;
  const p = live?.partnerLocation ?? null;
  const est = estimateEta({
    status: order.status as OrderStatus,
    now: new Date(),
    prepMinutes: order.get('prepMinutes') ?? 20,
    acceptedAt: order.acceptedAt,
    readyAt: order.readyAt,
    pickedUpAt: order.pickedUpAt,
    restaurantToCustomerKm: haversineKm(restaurantLoc, customerLoc),
    partnerToRestaurantKm: p ? haversineKm(p, restaurantLoc) : null,
    partnerToCustomerKm: p && ['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(order.status) ? haversineKm(p, customerLoc) : null,
    routedLastLegMinutes: order.get('routedMinutes') ?? null,
  });
  order.eta = est ? { ...est, reason, computedAt: new Date() } : null;
}

/** The only place an order's status changes. Validates actor permissions and appends to the timeline. */
export function applyTransition(order: OrderDoc, to: OrderStatus, actor: Actor, note = '') {
  assertTransition(order.status as OrderStatus, to, actor);
  const now = new Date();
  order.status = to;
  order.timeline.push({ status: to, at: now, actor, note });
  if (to === 'CONFIRMED') order.confirmedAt = now;
  if (to === 'ACCEPTED') order.acceptedAt = now;
  if (to === 'READY_FOR_PICKUP') order.readyAt = now;
  if (to === 'PICKED_UP') order.pickedUpAt = now;
  if (to === 'DELIVERED') order.deliveredAt = now;
  if (to === 'CANCELLED' || to === 'REJECTED') {
    order.cancelledAt = now;
    order.cancelReason = note;
  }
  refreshEta(order, STATUS_LABELS[to]);
  if (to === 'CONFIRMED' && order.eta && !order.promisedEta) order.promisedEta = order.eta;
}

export async function notifyCustomer(
  order: OrderDoc,
  event: NotificationEvent,
  session?: ClientSession,
  extra: { amount?: number; dedupeSuffix?: string } = {},
) {
  const customer = await UserModel.findById(order.customerId).select('name smsOptIn').session(session ?? null).lean();
  const eta = order.eta
    ? `${new Date(Date.now() + order.eta.minMinutes! * 60000).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}–${new Date(Date.now() + order.eta.maxMinutes! * 60000).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
    : undefined;
  await enqueueSms(
    {
      event,
      orderId: order._id,
      userId: order.customerId,
      to: order.contactPhone,
      smsOptIn: customer?.smsOptIn ?? false,
      dedupeSuffix: extra.dedupeSuffix,
      ctx: {
        firstName: (customer?.name ?? '').split(' ')[0],
        orderNumber: order.orderNumber,
        restaurant: order.restaurantSnapshot?.name ?? '',
        total: order.pricing?.total ?? 0,
        eta,
        amount: extra.amount,
        otp: event === 'ORDER_PICKED_UP' ? order.get('deliveryOtp') : undefined,
      },
    },
    session,
  );
}

/** Emits a minimal change signal; each client refetches the role-appropriate view over REST. */
export function broadcastOrder(order: OrderDoc) {
  const payload = { orderId: String(order._id), status: order.status, eta: order.eta, updatedAt: new Date().toISOString() };
  const targets = [rooms.order(String(order._id)), rooms.restaurant(String(order.restaurantId)), rooms.admin];
  if (order.partnerId) targets.push(rooms.partner(String(order.partnerId)));
  emit(targets, 'order:updated', payload);
}

// ── Customer: create & pay ───────────────────────────────────────────────────

export async function createOrder(user: AuthUser, input: CreateOrderInput & { addressId: string }, idempotencyKey: string) {
  const existing = await OrderModel.findOne({ customerId: user.id, idempotencyKey });
  if (existing) {
    const payment = existing.paymentId ? await PaymentModel.findById(existing.paymentId).lean() : null;
    return { order: existing, payment, replayed: true };
  }

  const address = await AddressModel.findOne({ _id: input.addressId, userId: user.id }).lean();
  if (!address) throw notFound('Address');
  const dbUser = await UserModel.findById(user.id).lean();
  const sq = await buildServerQuote({
    restaurantId: input.restaurantId,
    lines: input.lines,
    location: fromPoint(address.location),
    couponCode: input.couponCode,
    userId: user.id,
    dietary: (dbUser?.dietary as DietaryProfile) ?? null,
  });
  if (sq.blockers.length) throw new AppError(422, sq.blockers[0].code, sq.blockers[0].message, { blockers: sq.blockers });
  if (input.couponCode && sq.couponError) throw new AppError(422, 'COUPON_INVALID', sq.couponError.message, sq.couponError);
  if (sq.quote.total !== input.expectedTotal)
    throw conflict('PRICE_CHANGED', 'Prices changed since you last looked. Please review the updated total.', {
      quote: sq.quote,
      previousTotal: input.expectedTotal,
    });

  const cfg = await getPricingConfig();
  const bps = sq.restaurant.commissionBps ?? cfg.defaultCommissionBps;
  const c = commissionFor(sq.quote.itemTotal, sq.quote.packagingFee, bps);
  const routed = await routeMinutes(fromPoint(sq.restaurant.location)!, fromPoint(address.location)!);

  const { order, payment } = await withTransaction(async (session) => {
    const [order] = await OrderModel.create(
      [
        {
          orderNumber: generateOrderNumber(),
          customerId: user.id,
          restaurantId: sq.restaurant._id,
          restaurantSnapshot: {
            name: sq.restaurant.name,
            phone: sq.restaurant.phone,
            locality: sq.restaurant.address?.locality ?? '',
            location: sq.restaurant.location,
          },
          prepMinutes: Math.round(sq.restaurant.avgPrepMinutes ?? sq.restaurant.prepTimeMinutes),
          routedMinutes: routed,
          deliveryAddress: { ...address, location: address.location },
          contactName: dbUser?.name ?? user.name,
          contactPhone: dbUser?.phone ?? user.phone,
          items: sq.lines.map(({ dietaryReasons: _d, ...l }) => l),
          pricing: sq.quote,
          coupon: sq.coupon ? { couponId: sq.coupon._id, code: sq.coupon.code, discount: sq.quote.discount } : null,
          commission: { bps, amount: c.commission, gst: c.gstOnCommission },
          distanceKm: sq.distanceKm,
          instructions: input.instructions ?? '',
          status: 'PAYMENT_PENDING',
          timeline: [{ status: 'PAYMENT_PENDING', at: new Date(), actor: 'customer', note: '' }],
          deliveryOtp: String(crypto.randomInt(1000, 10000)),
          idempotencyKey,
        },
      ],
      { session },
    );
    refreshEta(order, 'Order created');
    const [payment] = await PaymentModel.create(
      [{ orderId: order._id, customerId: user.id, provider: getPaymentProvider().name, amount: sq.quote.total, attempt: 1 }],
      { session },
    );
    order.paymentId = payment._id;
    await order.save({ session });
    return { order, payment };
  });

  const started = await startCheckout(order, payment._id.toString());
  return { order, payment: started, replayed: false };
}

/** Opens a provider checkout. On provider failure the order lands in PAYMENT_FAILED with a retry path. */
async function startCheckout(order: OrderDoc, paymentId: string) {
  const customer = await UserModel.findById(order.customerId).select('email').lean();
  try {
    const r = await getPaymentProvider().createCheckout({
      paymentId,
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      amount: order.pricing!.total!,
      customerEmail: customer?.email,
    });
    return await PaymentModel.findByIdAndUpdate(
      paymentId,
      { $set: { status: 'PENDING', providerRef: r.providerRef, checkoutUrl: r.checkoutUrl } },
      { new: true },
    ).lean();
  } catch (err) {
    await withTransaction(async (session) => {
      await PaymentModel.updateOne(
        { _id: paymentId },
        { $set: { status: 'FAILED', failureReason: 'Could not reach payment provider' } },
        { session },
      );
      const o = await OrderModel.findById(order._id).session(session);
      if (o && o.status === 'PAYMENT_PENDING') {
        applyTransition(o, 'PAYMENT_FAILED', 'system', 'Payment provider unavailable');
        await o.save({ session });
      }
    });
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'We could not start the payment. No money was taken — please retry.', {
      orderId: String(order._id),
      cause: (err as Error).message,
    });
  }
}

export async function retryPayment(user: AuthUser, orderId: string) {
  const order = await OrderModel.findOne({ _id: orderId, customerId: user.id });
  if (!order) throw notFound('Order');
  if (order.status === 'PAYMENT_PENDING') {
    const p = await PaymentModel.findById(order.paymentId).lean();
    if (p?.status === 'PENDING' && p.checkoutUrl) return p;
  }
  const payment = await withTransaction(async (session) => {
    const o = await OrderModel.findById(orderId).session(session);
    if (!o) throw notFound('Order');
    const last = await PaymentModel.findOne({ orderId }).sort({ attempt: -1 }).session(session);
    if (last?.status === 'SUCCEEDED') throw conflict('ALREADY_PAID', 'This order is already paid.');
    if (o.status === 'PAYMENT_FAILED') applyTransition(o, 'PAYMENT_PENDING', 'customer', 'Payment retried');
    else if (o.status !== 'PAYMENT_PENDING') throw conflict('NOT_PAYABLE', 'This order cannot be paid any more.');
    if (last && ['CREATED', 'PENDING'].includes(last.status)) {
      last.status = 'CANCELED';
      last.failureReason = 'Superseded by a new attempt';
      await last.save({ session });
    }
    const [p] = await PaymentModel.create(
      [{ orderId: o._id, customerId: o.customerId, provider: getPaymentProvider().name, amount: o.pricing!.total!, attempt: (last?.attempt ?? 0) + 1 }],
      { session },
    );
    o.paymentId = p._id;
    await o.save({ session });
    return p;
  });
  const fresh = (await OrderModel.findById(orderId))!;
  return startCheckout(fresh, String(payment._id));
}

// ── Cancellation & restaurant actions ─────────────────────────────────────────

export async function cancelByCustomer(user: AuthUser, orderId: string, reason: string) {
  const { order, refund } = await withTransaction(async (session) => {
    const order = await OrderModel.findOne({ _id: orderId, customerId: user.id }).session(session);
    if (!order) throw notFound('Order');
    const paid = order.status === 'CONFIRMED';
    applyTransition(order, 'CANCELLED', 'customer', reason || 'Cancelled by customer');
    await order.save({ session });
    await PaymentModel.updateMany(
      { orderId: order._id, status: { $in: ['CREATED', 'PENDING'] } },
      { $set: { status: 'CANCELED', failureReason: 'Order cancelled' } },
      { session },
    );
    await notifyCustomer(order, 'ORDER_CANCELLED', session);
    await releaseAssignment(order._id, session);
    return { order, refund: paid };
  });
  broadcastOrder(order);
  if (refund) await issueRefund({ orderId: String(order._id), amount: order.pricing!.total!, reason: 'customer_cancelled', kind: 'auto' });
  return order;
}

export async function adminCancel(orderId: string, reason: string) {
  const { order, paid } = await withTransaction(async (session) => {
    const order = await OrderModel.findById(orderId).session(session);
    if (!order) throw notFound('Order');
    const paid = ['CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'].includes(order.status);
    applyTransition(order, 'CANCELLED', 'admin', reason);
    await order.save({ session });
    await notifyCustomer(order, 'ORDER_CANCELLED', session);
    await releaseAssignment(order._id, session);
    return { order, paid };
  });
  broadcastOrder(order);
  if (paid) await issueRefund({ orderId, amount: order.pricing!.total! - order.refundedAmount, reason: 'admin_cancelled', kind: 'auto' });
  return order;
}

const RESTAURANT_EVENTS: Partial<Record<OrderStatus, NotificationEvent>> = {
  ACCEPTED: 'ORDER_ACCEPTED',
  REJECTED: 'ORDER_REJECTED',
  READY_FOR_PICKUP: 'ORDER_READY',
};

export async function restaurantUpdateStatus(user: AuthUser, orderId: string, to: OrderStatus, reason = '') {
  const restaurant = await RestaurantModel.findOne({ ownerId: user.id }).select('_id avgPrepMinutes prepTimeMinutes').lean();
  if (!restaurant) throw forbidden('No restaurant linked to this account');
  const order = await withTransaction(async (session) => {
    const order = await OrderModel.findOne({ _id: orderId, restaurantId: restaurant._id }).select('+deliveryOtp').session(session);
    if (!order) throw notFound('Order');
    applyTransition(order, to, 'restaurant', reason);
    await order.save({ session });
    const ev = RESTAURANT_EVENTS[to];
    if (ev) await notifyCustomer(order, ev, session);
    if (to === 'ACCEPTED') await createAssignment(order, session);
    if (to === 'READY_FOR_PICKUP' && order.acceptedAt) {
      // Learn this kitchen's real prep time (exponential moving average) for future ETAs.
      const actual = (Date.now() - order.acceptedAt.getTime()) / 60000;
      const prev = restaurant.avgPrepMinutes ?? restaurant.prepTimeMinutes;
      const next = Math.round((prev * 0.7 + Math.min(Math.max(actual, 3), 90) * 0.3) * 10) / 10;
      await RestaurantModel.updateOne({ _id: restaurant._id }, { $set: { avgPrepMinutes: next } }, { session });
    }
    if (to === 'REJECTED') await releaseAssignment(order._id, session);
    return order;
  });
  broadcastOrder(order);
  if (to === 'ACCEPTED') await offerNextPartner(String(order._id));
  if (to === 'REJECTED') await issueRefund({ orderId, amount: order.pricing!.total!, reason: 'restaurant_rejected', kind: 'auto' });
  return order;
}

// ── Serialisation per viewer (least privilege) ────────────────────────────────

type Viewer = 'customer' | 'restaurant' | 'delivery' | 'admin';

export async function serializeOrder(order: OrderDoc, viewer: Viewer) {
  const o = order.toObject({ virtuals: false }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const assignment = await AssignmentModel.findOne({ orderId: order._id }).lean();
  const partner = assignment?.partnerId ? await UserModel.findById(assignment.partnerId).select('name').lean() : null;
  const base = {
    id: String(o._id),
    orderNumber: o.orderNumber,
    status: o.status,
    statusLabel: STATUS_LABELS[o.status as OrderStatus],
    restaurant: {
      id: String(o.restaurantId),
      name: o.restaurantSnapshot?.name,
      locality: o.restaurantSnapshot?.locality,
      location: fromPoint(o.restaurantSnapshot?.location),
    },
    items: o.items,
    pricing: o.pricing,
    coupon: o.coupon ? { code: o.coupon.code, discount: o.coupon.discount } : null,
    timeline: o.timeline,
    eta: o.eta,
    instructions: o.instructions,
    refundStatus: o.refundStatus,
    refundedAmount: o.refundedAmount,
    reviewed: o.reviewed,
    distanceKm: o.distanceKm,
    createdAt: o.createdAt,
    deliveredAt: o.deliveredAt,
    cancelReason: o.cancelReason,
    delivery: assignment
      ? {
          status: assignment.status,
          partnerName: partner?.name?.split(' ')[0] ?? null,
          lastLocation:
            assignment.lastLocation && ['ACCEPTED', 'PICKED_UP'].includes(assignment.status) ? assignment.lastLocation : null,
        }
      : null,
  };
  const customerFirstName = String(o.contactName ?? '').split(' ')[0];
  const dropAddress = {
    line1: o.deliveryAddress?.line1,
    line2: o.deliveryAddress?.line2,
    locality: o.deliveryAddress?.locality,
    landmark: o.deliveryAddress?.landmark,
    city: o.deliveryAddress?.city,
    pincode: o.deliveryAddress?.pincode,
    location: fromPoint(o.deliveryAddress?.location),
  };
  switch (viewer) {
    case 'customer': {
      const showOtp = ['CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(o.status);
      const otp = showOtp ? (await OrderModel.findById(o._id).select('+deliveryOtp').lean())?.deliveryOtp : undefined;
      return { ...base, deliveryAddress: dropAddress, deliveryOtp: otp, promisedEta: o.promisedEta };
    }
    case 'restaurant':
      return { ...base, customerName: customerFirstName, dropLocality: o.deliveryAddress?.locality, commission: o.commission };
    case 'delivery': {
      const active = ['ACCEPTED', 'PICKED_UP'].includes(assignment?.status ?? '');
      return {
        ...base,
        pricing: undefined,
        restaurantPhone: active ? o.restaurantSnapshot?.phone : undefined,
        customerName: customerFirstName,
        customerPhone: active ? o.contactPhone : undefined,
        deliveryAddress: dropAddress,
        earnings: assignment?.earnings ?? null,
      };
    }
    case 'admin':
      return {
        ...base,
        customerId: String(o.customerId),
        customerName: o.contactName,
        deliveryAddress: dropAddress,
        commission: o.commission,
        promisedEta: o.promisedEta,
        assignment,
        paymentId: o.paymentId ? String(o.paymentId) : null,
      };
  }
}

