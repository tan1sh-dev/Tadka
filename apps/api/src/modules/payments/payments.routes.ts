import crypto from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { objectId } from '@tadka/shared';
import { env, isProd } from '../../config/env';
import { AppError, notFound, parse } from '../../lib/errors';
import { currentUser, requireAuth } from '../../middleware/auth';
import { OrderModel, PaymentModel } from '../../models/order';
import { getPaymentProvider, mockSign } from './payment.provider';
import { processWebhook } from './payments.service';

/** Webhooks need the raw body for signature verification; mounted before express.json() and CSRF. */
export const webhookRouter = Router();
webhookRouter.post('/:provider', express.raw({ type: '*/*', limit: '512kb' }), async (req, res) => {
  const result = await processWebhook(String(req.params.provider), req.body as Buffer, req.headers);
  res.json({ received: true, ...result });
});

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.get('/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const p = await PaymentModel.findOne({ _id: id, customerId: currentUser(req).id }).lean();
  if (!p) throw notFound('Payment');
  const order = await OrderModel.findById(p.orderId).select('orderNumber status pricing.total restaurantSnapshot.name').lean();
  res.json({
    payment: {
      id: String(p._id),
      orderId: String(p.orderId),
      status: p.status,
      amount: p.amount,
      provider: p.provider,
      checkoutUrl: p.checkoutUrl,
      failureReason: p.failureReason,
    },
    order: order && { orderNumber: order.orderNumber, status: order.status, restaurant: order.restaurantSnapshot?.name },
  });
});

/**
 * Mock gateway (development only). The "Pay" button posts here; we build a provider-shaped event, sign it with
 * the mock secret, and push it through the exact same webhook pipeline Stripe events use.
 */
paymentsRouter.post('/mock/:id/simulate', async (req, res) => {
  if (isProd || getPaymentProvider().name !== 'mock') throw new AppError(404, 'NOT_FOUND', 'Mock gateway disabled');
  const id = parse(objectId, req.params.id);
  const { outcome } = parse(z.object({ outcome: z.enum(['success', 'failure']) }), req.body);
  const p = await PaymentModel.findOne({ _id: id, customerId: currentUser(req).id }).lean();
  if (!p || !p.providerRef) throw notFound('Payment');
  const body = JSON.stringify({
    id: `mock_evt_${crypto.randomUUID()}`,
    type: outcome === 'success' ? 'payment.succeeded' : 'payment.failed',
    providerRef: p.providerRef,
    providerPaymentId: `mock_pi_${p._id}`,
    amount: p.amount,
    failureReason: outcome === 'failure' ? 'Card declined (test)' : undefined,
  });
  const result = await processWebhook('mock', Buffer.from(body), { 'x-mock-signature': mockSign(body) });
  res.json(result);
});

export const paymentsInfo = () => ({ provider: getPaymentProvider().name, mock: getPaymentProvider().name === 'mock', env: env.NODE_ENV });
