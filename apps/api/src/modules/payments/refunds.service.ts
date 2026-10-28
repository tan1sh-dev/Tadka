import { AppError, conflict, notFound } from '../../lib/errors';
import { withTransaction } from '../../lib/db';
import { logger } from '../../lib/logger';
import { OrderModel, PaymentModel, RefundModel } from '../../models/order';
import { emit, rooms } from '../../realtime/io';
import { getPaymentProvider } from './payment.provider';
import { notifyCustomer } from '../orders/orders.service';

interface IssueArgs {
  orderId: string;
  amount: number;
  reason: string;
  kind: 'auto' | 'requested';
  /** Existing REQUESTED/APPROVED refund to execute (admin approval flow). */
  refundId?: string;
  decidedBy?: string;
}

/**
 * Executes a refund against the provider. The Refund record is created first (PROCESSING), so a crash between
 * the provider call and our bookkeeping leaves a visible, retryable record rather than a silent gap.
 */
export async function issueRefund(a: IssueArgs) {
  const payment = await PaymentModel.findOne({ orderId: a.orderId, status: { $in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } });
  if (!payment) {
    // Nothing captured — nothing to refund (e.g. cancelled while payment pending).
    return null;
  }
  const inFlight = await RefundModel.aggregate<{ sum: number }>([
    { $match: { orderId: payment.orderId, status: { $in: ['PROCESSING'] }, ...(a.refundId ? { _id: { $ne: a.refundId } } : {}) } },
    { $group: { _id: null, sum: { $sum: '$amount' } } },
  ]);
  const remaining = payment.amount - payment.refundedAmount - (inFlight[0]?.sum ?? 0);
  const amount = Math.min(a.amount, remaining);
  if (amount <= 0) throw conflict('NOTHING_TO_REFUND', 'This order has already been fully refunded.');

  const refund = await withTransaction(async (session) => {
    let r;
    if (a.refundId) {
      r = await RefundModel.findOneAndUpdate(
        { _id: a.refundId, status: { $in: ['REQUESTED', 'APPROVED', 'FAILED'] } },
        { $set: { status: 'PROCESSING', amount, paymentId: payment._id, decidedBy: a.decidedBy ?? null } },
        { new: true, session },
      );
      if (!r) throw conflict('REFUND_STATE', 'This refund is not awaiting processing.');
    } else {
      [r] = await RefundModel.create(
        [{ orderId: a.orderId, paymentId: payment._id, amount, kind: a.kind, reason: a.reason, status: 'PROCESSING' }],
        { session },
      );
    }
    await OrderModel.updateOne({ _id: a.orderId }, { $set: { refundStatus: 'PENDING' } }, { session });
    return r;
  });

  let result;
  try {
    result = await getPaymentProvider().refund({
      providerRef: payment.providerRef ?? '',
      providerPaymentId: payment.providerPaymentId ?? null,
      amount,
      idempotencyKey: String(refund._id),
    });
  } catch (err) {
    logger.error({ err: (err as Error).message, refundId: String(refund._id) }, 'Refund call failed');
    await markRefundFailed(String(refund._id), (err as Error).message);
    throw new AppError(502, 'REFUND_FAILED', 'The payment provider could not process this refund. It can be retried.');
  }

  await RefundModel.updateOne({ _id: refund._id }, { $set: { providerRefundId: result.providerRefundId } });
  if (result.status === 'succeeded') await markRefundSucceeded(result.providerRefundId);
  else if (result.status === 'failed') await markRefundFailed(String(refund._id), result.failureReason ?? 'failed');
  return RefundModel.findById(refund._id).lean();
}

export async function markRefundSucceeded(providerRefundId: string) {
  const order = await withTransaction(async (session) => {
    const refund = await RefundModel.findOneAndUpdate(
      { providerRefundId, status: 'PROCESSING' },
      { $set: { status: 'SUCCEEDED' } },
      { new: true, session },
    );
    if (!refund) return null; // already applied (duplicate webhook) or unknown
    const payment = await PaymentModel.findById(refund.paymentId).session(session);
    if (!payment) throw notFound('Payment');
    payment.refundedAmount += refund.amount;
    payment.status = payment.refundedAmount >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    await payment.save({ session });
    const order = await OrderModel.findById(refund.orderId).select('+deliveryOtp').session(session);
    if (!order) throw notFound('Order');
    order.refundedAmount = payment.refundedAmount;
    order.refundStatus = payment.status === 'REFUNDED' ? 'REFUNDED' : 'PARTIAL';
    await order.save({ session });
    await notifyCustomer(order, 'REFUND_UPDATED', session, { amount: refund.amount, dedupeSuffix: String(refund._id) });
    return order;
  });
  if (order) emit([rooms.order(String(order._id)), rooms.admin], 'order:updated', { orderId: String(order._id), status: order.status });
}

export async function markRefundFailed(refundId: string, reason: string, byProviderId = false) {
  const refund = await RefundModel.findOneAndUpdate(
    { ...(byProviderId ? { providerRefundId: refundId } : { _id: refundId }), status: 'PROCESSING' },
    { $set: { status: 'FAILED', failureReason: reason.slice(0, 300) } },
    { new: true },
  );
  if (refund) await OrderModel.updateOne({ _id: refund.orderId }, { $set: { refundStatus: 'FAILED' } });
}
