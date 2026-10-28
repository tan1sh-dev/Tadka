import { AppError } from '../../lib/errors';
import { withTransaction } from '../../lib/db';
import { logger } from '../../lib/logger';
import { CouponModel, CouponRedemptionModel, OrderModel, PaymentModel, WebhookEventModel } from '../../models/order';
import { emit, rooms } from '../../realtime/io';
import { applyTransition, broadcastOrder, notifyCustomer } from '../orders/orders.service';
import { getPaymentProvider, type NormalizedEvent } from './payment.provider';
import { issueRefund, markRefundFailed, markRefundSucceeded } from './refunds.service';

export type WebhookOutcome =
  | 'processed'
  | 'duplicate'
  | 'ignored'
  | 'unknown_payment'
  | 'amount_mismatch'
  | 'stale'
  | 'refund_late_payment';

/**
 * Single entry point for all payment provider events (real webhooks and the mock gateway).
 * Guarantees:
 *  - signature verified before anything is read
 *  - each provider event id is applied at most once (unique WebhookEvent insert in the same transaction)
 *  - payment status is monotonic: SUCCEEDED/REFUNDED never regress on late or out-of-order events
 *  - order confirmation and payment success are committed atomically
 */
export async function processWebhook(
  providerName: string,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<{ outcome: WebhookOutcome; eventId: string }> {
  const provider = getPaymentProvider();
  if (provider.name !== providerName) throw new AppError(404, 'NOT_FOUND', 'Unknown payment provider');
  const event = provider.verifyWebhook(rawBody, headers);

  if (event.type === 'refund.succeeded' || event.type === 'refund.failed') {
    const outcome = await recordOnce(event, async () => {
      if (event.type === 'refund.succeeded') await markRefundSucceeded(event.providerRefundId!);
      else await markRefundFailed(event.providerRefundId!, event.failureReason ?? 'failed', true);
      return 'processed';
    });
    return { outcome, eventId: event.id };
  }
  if (event.type === 'ignored') return { outcome: 'ignored', eventId: event.id };

  let needsRefund: { orderId: string; amount: number } | null = null;
  let touchedOrderId: string | null = null;

  const outcome = await recordOnce(event, async (session) => {
    const payment = await PaymentModel.findOne({ provider: provider.name, providerRef: event.providerRef }).session(session);
    if (!payment) {
      logger.warn({ eventId: event.id, type: event.type }, 'Webhook for unknown payment');
      return 'unknown_payment';
    }
    payment.events.push({ type: event.rawType, at: new Date(), eventId: event.id });
    const order = await OrderModel.findById(payment.orderId).select('+deliveryOtp').session(session);
    if (!order) throw new AppError(500, 'ORPHAN_PAYMENT', 'Payment without order');
    touchedOrderId = String(order._id);

    if (event.type === 'payment.succeeded') {
      if (['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
        await payment.save({ session });
        return 'stale';
      }
      if (event.amount !== undefined && event.amount !== payment.amount) {
        payment.failureReason = `Amount mismatch: expected ${payment.amount}, got ${event.amount}`;
        await payment.save({ session });
        logger.error({ paymentId: String(payment._id), eventId: event.id }, 'Payment amount mismatch — not confirming order');
        return 'amount_mismatch';
      }
      payment.status = 'SUCCEEDED';
      payment.providerPaymentId = event.providerPaymentId ?? payment.providerPaymentId;
      payment.failureReason = '';
      await payment.save({ session });

      // Money was captured for an attempt that is no longer the order's live attempt, or for an order
      // the customer already cancelled: keep the books straight and refund it.
      const isCurrentAttempt = String(order.paymentId) === String(payment._id);
      if (!isCurrentAttempt || !['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.status)) {
        needsRefund = { orderId: String(order._id), amount: payment.amount };
        return 'refund_late_payment';
      }

      applyTransition(order, 'CONFIRMED', 'system', 'Payment verified by provider');
      await order.save({ session });
      if (order.coupon?.couponId) {
        await CouponRedemptionModel.create([{ couponId: order.coupon.couponId, userId: order.customerId, orderId: order._id }], {
          session,
        });
        await CouponModel.updateOne({ _id: order.coupon.couponId }, { $inc: { usedCount: 1 } }, { session });
      }
      await notifyCustomer(order, 'PAYMENT_CONFIRMED', session);
      return 'processed';
    }

    // failed / expired
    if (['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED', 'CANCELED'].includes(payment.status)) {
      await payment.save({ session });
      return 'stale';
    }
    payment.status = event.type === 'payment.failed' ? 'FAILED' : 'CANCELED';
    payment.failureReason = event.failureReason ?? (event.type === 'payment.expired' ? 'Checkout session expired' : 'Payment failed');
    await payment.save({ session });
    if (String(order.paymentId) === String(payment._id) && order.status === 'PAYMENT_PENDING') {
      applyTransition(order, 'PAYMENT_FAILED', 'system', payment.failureReason);
      await order.save({ session });
      await notifyCustomer(order, 'PAYMENT_FAILED', session, { dedupeSuffix: String(payment._id) });
    }
    return 'processed';
  });

  if (touchedOrderId && outcome === 'processed') {
    const order = await OrderModel.findById(touchedOrderId);
    if (order) {
      broadcastOrder(order);
      if (order.status === 'CONFIRMED')
        emit(rooms.restaurant(String(order.restaurantId)), 'order:new', { orderId: touchedOrderId, orderNumber: order.orderNumber });
    }
  }
  if (needsRefund) {
    const r: { orderId: string; amount: number } = needsRefund;
    await issueRefund({ orderId: r.orderId, amount: r.amount, reason: 'late_or_superseded_payment', kind: 'auto' }).catch((err) =>
      logger.error({ err: (err as Error).message, orderId: r.orderId }, 'Auto-refund of late payment failed'),
    );
  }
  return { outcome, eventId: event.id };
}

async function recordOnce(
  event: NormalizedEvent,
  apply: (session: import('mongoose').ClientSession) => Promise<WebhookOutcome>,
): Promise<WebhookOutcome> {
  try {
    return await withTransaction(async (session) => {
      await WebhookEventModel.create([{ provider: getPaymentProvider().name, eventId: event.id, type: event.rawType }], { session });
      const outcome = await apply(session);
      await WebhookEventModel.updateOne({ provider: getPaymentProvider().name, eventId: event.id }, { $set: { outcome } }, { session });
      return outcome;
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return 'duplicate';
    throw err;
  }
}
