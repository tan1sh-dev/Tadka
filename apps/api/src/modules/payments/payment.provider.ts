import crypto from 'node:crypto';
import Stripe from 'stripe';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';

export type NormalizedEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.expired'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'ignored';

export interface NormalizedEvent {
  id: string;
  type: NormalizedEventType;
  rawType: string;
  providerRef?: string;
  providerPaymentId?: string;
  amount?: number;
  providerRefundId?: string;
  failureReason?: string;
}

export interface CheckoutArgs {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  customerEmail?: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'succeeded' | 'pending' | 'failed';
  failureReason?: string;
}

/** Provider-agnostic payment port. Adding Razorpay/Cashfree means implementing these three methods. */
export interface PaymentProvider {
  readonly name: 'mock' | 'stripe';
  createCheckout(a: CheckoutArgs): Promise<{ providerRef: string; checkoutUrl: string }>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent;
  refund(a: { providerRef: string; providerPaymentId: string | null; amount: number; idempotencyKey: string }): Promise<RefundResult>;
}

const badSignature = () => new AppError(400, 'BAD_SIGNATURE', 'Webhook signature verification failed');

// ── Mock provider ───────────────────────────────────────────────────────────
export function mockSign(body: string): string {
  return crypto.createHmac('sha256', env.MOCK_PAYMENT_SECRET).update(body).digest('hex');
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async createCheckout(a: CheckoutArgs) {
    return { providerRef: `mock_cs_${a.paymentId}`, checkoutUrl: `${env.WEB_ORIGIN}/pay/mock/${a.paymentId}` };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent {
    const sig = String(headers['x-mock-signature'] ?? '');
    const expected = mockSign(rawBody.toString('utf8'));
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw badSignature();
    const e = JSON.parse(rawBody.toString('utf8')) as NormalizedEvent;
    return { ...e, rawType: e.type };
  }

  async refund(a: { amount: number; idempotencyKey: string }): Promise<RefundResult> {
    return { providerRefundId: `mock_re_${a.idempotencyKey}`, status: 'succeeded' };
  }
}

// ── Stripe provider ─────────────────────────────────────────────────────────
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  private stripe = new Stripe(env.STRIPE_SECRET_KEY ?? '', { timeout: 10_000, maxNetworkRetries: 2 });

  async createCheckout(a: CheckoutArgs) {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        currency: 'inr',
        line_items: [
          {
            quantity: 1,
            price_data: { currency: 'inr', unit_amount: a.amount, product_data: { name: `Tadka order ${a.orderNumber}` } },
          },
        ],
        client_reference_id: a.paymentId,
        customer_email: a.customerEmail,
        metadata: { paymentId: a.paymentId, orderId: a.orderId },
        payment_intent_data: { metadata: { paymentId: a.paymentId, orderId: a.orderId } },
        success_url: `${env.WEB_ORIGIN}/orders/${a.orderId}?payment=return`,
        cancel_url: `${env.WEB_ORIGIN}/orders/${a.orderId}?payment=cancelled`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
      { idempotencyKey: `checkout_${a.paymentId}` },
    );
    if (!session.url) throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Stripe did not return a checkout URL');
    return { providerRef: session.id, checkoutUrl: session.url };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, String(headers['stripe-signature'] ?? ''), env.STRIPE_WEBHOOK_SECRET ?? '');
    } catch {
      throw badSignature();
    }
    const base = { id: event.id, rawType: event.type };
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const s = event.data.object;
        if (s.payment_status !== 'paid') return { ...base, type: 'ignored' };
        return {
          ...base,
          type: 'payment.succeeded',
          providerRef: s.id,
          providerPaymentId: typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? undefined),
          amount: s.amount_total ?? undefined,
        };
      }
      case 'checkout.session.async_payment_failed':
        return { ...base, type: 'payment.failed', providerRef: event.data.object.id, failureReason: 'Payment was declined' };
      case 'checkout.session.expired':
        return { ...base, type: 'payment.expired', providerRef: event.data.object.id };
      case 'refund.updated':
      case 'refund.created': {
        const r = event.data.object;
        if (r.status === 'succeeded') return { ...base, type: 'refund.succeeded', providerRefundId: r.id };
        if (r.status === 'failed' || r.status === 'canceled')
          return { ...base, type: 'refund.failed', providerRefundId: r.id, failureReason: r.failure_reason ?? r.status };
        return { ...base, type: 'ignored' };
      }
      default:
        return { ...base, type: 'ignored' };
    }
  }

  async refund(a: { providerPaymentId: string | null; amount: number; idempotencyKey: string }): Promise<RefundResult> {
    if (!a.providerPaymentId) throw new AppError(409, 'REFUND_NOT_POSSIBLE', 'Payment has no captured intent to refund');
    const r = await this.stripe.refunds.create(
      { payment_intent: a.providerPaymentId, amount: a.amount },
      { idempotencyKey: `refund_${a.idempotencyKey}` },
    );
    const status = r.status === 'succeeded' ? 'succeeded' : r.status === 'failed' || r.status === 'canceled' ? 'failed' : 'pending';
    return { providerRefundId: r.id, status, failureReason: r.failure_reason ?? undefined };
  }
}

let provider: PaymentProvider | null = null;
export function getPaymentProvider(): PaymentProvider {
  provider ??= env.PAYMENT_PROVIDER === 'stripe' ? new StripePaymentProvider() : new MockPaymentProvider();
  return provider;
}
export function setPaymentProvider(p: PaymentProvider | null) {
  provider = p;
}
