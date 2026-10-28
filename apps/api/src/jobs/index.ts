import { env } from '../config/env';
import { withTransaction } from '../lib/db';
import { logger } from '../lib/logger';
import { OrderModel, PaymentModel } from '../models/order';
import { runDispatchCycle, releaseAssignment } from '../modules/delivery/delivery.service';
import { dispatchNotifications } from '../modules/notifications/notifications.service';
import { applyTransition, broadcastOrder, notifyCustomer } from '../modules/orders/orders.service';
import { issueRefund } from '../modules/payments/refunds.service';

export const UNPAID_ORDER_TTL_MS = 60 * 60_000;
export const ACCEPT_TIMEOUT_MS = 10 * 60_000;

/** Unpaid orders are cancelled after an hour so they don't linger in "awaiting payment". */
export async function expireUnpaidOrders() {
  const stale = await OrderModel.find({
    status: { $in: ['PAYMENT_PENDING', 'PAYMENT_FAILED'] },
    updatedAt: { $lt: new Date(Date.now() - UNPAID_ORDER_TTL_MS) },
  })
    .select('_id')
    .limit(50)
    .lean();
  for (const s of stale) {
    const order = await withTransaction(async (session) => {
      const o = await OrderModel.findById(s._id).session(session);
      if (!o || !['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(o.status)) return null;
      applyTransition(o, 'CANCELLED', 'system', 'Payment not completed in time');
      await o.save({ session });
      await PaymentModel.updateMany({ orderId: o._id, status: { $in: ['CREATED', 'PENDING'] } }, { $set: { status: 'CANCELED' } }, { session });
      return o;
    });
    if (order) broadcastOrder(order);
  }
}

/** Restaurants must respond within 10 minutes; otherwise the customer is refunded rather than left waiting. */
export async function autoRejectUnacceptedOrders() {
  const stale = await OrderModel.find({ status: 'CONFIRMED', confirmedAt: { $lt: new Date(Date.now() - ACCEPT_TIMEOUT_MS) } })
    .select('_id')
    .limit(50)
    .lean();
  for (const s of stale) {
    const order = await withTransaction(async (session) => {
      const o = await OrderModel.findById(s._id).select('+deliveryOtp').session(session);
      if (!o || o.status !== 'CONFIRMED') return null;
      applyTransition(o, 'REJECTED', 'system', 'Restaurant did not respond in time');
      await o.save({ session });
      await releaseAssignment(o._id, session);
      await notifyCustomer(o, 'ORDER_REJECTED', session);
      return o;
    });
    if (order) {
      broadcastOrder(order);
      await issueRefund({ orderId: String(order._id), amount: order.pricing!.total!, reason: 'restaurant_timeout', kind: 'auto' }).catch(
        (err) => logger.error({ err: (err as Error).message }, 'Auto refund failed'),
      );
    }
  }
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function tick() {
  if (running) return;
  running = true;
  try {
    await dispatchNotifications();
    await runDispatchCycle();
    await expireUnpaidOrders();
    await autoRejectUnacceptedOrders();
  } catch (err) {
    logger.error({ err }, 'Background job tick failed');
  } finally {
    running = false;
  }
}

export function startJobs() {
  if (!env.JOBS_ENABLED || timer) return;
  timer = setInterval(tick, env.JOB_INTERVAL_MS);
  logger.info({ intervalMs: env.JOB_INTERVAL_MS }, 'Background jobs started');
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}
