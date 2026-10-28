import type { ClientSession, Types } from 'mongoose';
import { formatINR, type NotificationEvent } from '@tadka/shared';
import { logger, maskPhone } from '../../lib/logger';
import { NotificationModel } from '../../models/ops';
import { getSmsProvider } from './sms.provider';

interface TemplateCtx {
  firstName: string;
  orderNumber: string;
  restaurant: string;
  total: number;
  eta?: string;
  otp?: string;
  amount?: number;
}

/** Centralised SMS copy. Keep under 160 GSM chars where possible; DLT templates must mirror these in India. */
export const SMS_TEMPLATES: Record<NotificationEvent, (c: TemplateCtx) => string> = {
  ORDER_PLACED: (c) => `Tadka: Order ${c.orderNumber} placed with ${c.restaurant}. We'll update you as it progresses.`,
  PAYMENT_CONFIRMED: (c) => `Tadka: Payment of ${formatINR(c.total)} received for order ${c.orderNumber}.`,
  PAYMENT_FAILED: (c) => `Tadka: Payment for order ${c.orderNumber} did not go through. No money was taken. Retry from the app.`,
  ORDER_ACCEPTED: (c) => `Tadka: ${c.restaurant} accepted order ${c.orderNumber}.${c.eta ? ` Est. arrival ${c.eta}.` : ''}`,
  ORDER_REJECTED: (c) => `Tadka: ${c.restaurant} couldn't take order ${c.orderNumber}. A full refund has been started.`,
  ORDER_READY: (c) => `Tadka: Order ${c.orderNumber} is packed and waiting for pickup.`,
  PARTNER_ASSIGNED: (c) => `Tadka: A delivery partner is assigned to order ${c.orderNumber}.`,
  ORDER_PICKED_UP: (c) => `Tadka: Order ${c.orderNumber} is on the way. Share OTP ${c.otp} only at handover.`,
  ORDER_DELIVERED: (c) => `Tadka: Order ${c.orderNumber} delivered. Enjoy, ${c.firstName}! Rate it in the app.`,
  ORDER_CANCELLED: (c) => `Tadka: Order ${c.orderNumber} was cancelled. Any payment taken will be refunded.`,
  REFUND_UPDATED: (c) => `Tadka: Refund of ${formatINR(c.amount ?? 0)} for order ${c.orderNumber} has been processed.`,
};

export interface EnqueueArgs {
  event: NotificationEvent;
  orderId: Types.ObjectId | string;
  userId: Types.ObjectId | string;
  to: string;
  smsOptIn: boolean;
  ctx: TemplateCtx;
  /** Distinguishes repeat events of the same type (e.g. multiple refunds). */
  dedupeSuffix?: string;
}

/**
 * Transactional outbox: the notification row is written in the same transaction as the state change.
 * The unique dedupeKey makes repeated triggers (webhook retries, double clicks) a no-op.
 */
export async function enqueueSms(a: EnqueueArgs, session?: ClientSession): Promise<void> {
  const dedupeKey = `${a.orderId}:${a.event}:sms:${a.userId}${a.dedupeSuffix ? `:${a.dedupeSuffix}` : ''}`;
  await NotificationModel.updateOne(
    { dedupeKey },
    {
      $setOnInsert: {
        dedupeKey,
        userId: a.userId,
        orderId: a.orderId,
        event: a.event,
        to: a.to,
        body: SMS_TEMPLATES[a.event](a.ctx),
        status: a.smsOptIn ? 'PENDING' : 'SKIPPED',
        lastError: a.smsOptIn ? '' : 'User opted out of SMS',
        nextAttemptAt: new Date(),
      },
    },
    { upsert: true, session },
  );
}

const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];
export const MAX_ATTEMPTS = 5;
const LEASE_MS = 60_000;

/** Sends due notifications. Safe to run concurrently: each row is claimed atomically. */
export async function dispatchNotifications(limit = 20): Promise<{ sent: number; failed: number }> {
  const provider = getSmsProvider();
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const now = new Date();
    const n = await NotificationModel.findOneAndUpdate(
      {
        $or: [
          { status: 'PENDING', nextAttemptAt: { $lte: now } },
          // reclaim rows stuck in SENDING (process crashed mid-send)
          { status: 'SENDING', nextAttemptAt: { $lte: new Date(now.getTime() - LEASE_MS) } },
        ],
      },
      { $set: { status: 'SENDING', nextAttemptAt: now }, $inc: { attempts: 1 } },
      { new: true, sort: { nextAttemptAt: 1 } },
    );
    if (!n) break;
    try {
      const r = await provider.send(n.to, n.body);
      n.status = 'SENT';
      n.provider = provider.name;
      n.providerMessageId = r.providerMessageId;
      n.lastError = '';
      sent++;
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      n.lastError = message;
      n.provider = provider.name;
      if (n.attempts >= MAX_ATTEMPTS) {
        n.status = 'FAILED';
      } else {
        n.status = 'PENDING';
        n.nextAttemptAt = new Date(Date.now() + BACKOFF_MS[Math.min(n.attempts - 1, BACKOFF_MS.length - 1)]);
      }
      failed++;
      logger.warn({ notificationId: String(n._id), to: maskPhone(n.to), attempts: n.attempts, err: message }, 'SMS send failed');
    }
    await n.save();
  }
  return { sent, failed };
}
