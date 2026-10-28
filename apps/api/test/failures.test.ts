import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { dispatchNotifications, MAX_ATTEMPTS } from '../src/modules/notifications/notifications.service';
import { NotificationModel } from '../src/models/ops';
import { OrderModel, PaymentModel, RefundModel } from '../src/models/order';
import { autoRejectUnacceptedOrders, ACCEPT_TIMEOUT_MS } from '../src/jobs';
import { mockSign } from '../src/modules/payments/payment.provider';
import { newCustomer, paneerLine, placeOrder, seedWorld, setupApp } from './helpers';

let app: Express;
let world: Awaited<ReturnType<typeof seedWorld>>;
let rid: string;

beforeAll(async () => {
  app = await setupApp();
  world = await seedWorld(app);
  rid = String(world.restaurant._id);
});

async function paidOrder(phone?: string) {
  const cust = await newCustomer(app, phone);
  const { res } = await placeOrder(cust.c, rid, cust.addressId, [paneerLine(String(world.items.paneer._id))]);
  await cust.c.post(`/payments/mock/${res.body.payment.id}/simulate`, { outcome: 'success' });
  return { ...cust, orderId: res.body.order.id as string, paymentId: res.body.payment.id as string, total: res.body.order.pricing.total as number };
}

describe('rejections, cancellations and refunds', () => {
  it('restaurant rejection triggers an automatic full refund', async () => {
    const { c, orderId, total } = await paidOrder();
    expect((await world.owner.post(`/merchant/orders/${orderId}/status`, { to: 'REJECTED' })).status).toBe(400); // reason required
    const r = await world.owner.post(`/merchant/orders/${orderId}/status`, { to: 'REJECTED', reason: 'Out of paneer' });
    expect(r.status).toBe(200);
    const o = (await c.get(`/orders/${orderId}`)).body.order;
    expect(o.status).toBe('REJECTED');
    expect(o.refundStatus).toBe('REFUNDED');
    expect(o.refundedAmount).toBe(total);
    const p = await PaymentModel.findOne({ orderId });
    expect(p?.status).toBe('REFUNDED');
  });

  it('customer can cancel before acceptance (refunded) but not after', async () => {
    const a = await paidOrder();
    const r = await a.c.post(`/orders/${a.orderId}/cancel`, { reason: 'Changed my mind' });
    expect(r.status).toBe(200);
    expect(r.body.order.status).toBe('CANCELLED');
    expect((await a.c.get(`/orders/${a.orderId}`)).body.order.refundStatus).toBe('REFUNDED');

    const b = await paidOrder();
    await world.owner.post(`/merchant/orders/${b.orderId}/status`, { to: 'ACCEPTED' });
    const late = await b.c.post(`/orders/${b.orderId}/cancel`);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('INVALID_TRANSITION');
    // free the seeded partner's pending offer for later tests
    await world.admin.post(`/admin/orders/${b.orderId}/cancel`, { reason: 'test cleanup' });
  });

  it('refunds a payment that succeeds after the order was cancelled', async () => {
    const { c, addressId } = await newCustomer(app);
    const { res } = await placeOrder(c, rid, addressId, [paneerLine(String(world.items.paneer._id))]);
    await c.post(`/orders/${res.body.order.id}/cancel`);
    const p = await PaymentModel.findById(res.body.payment.id);
    const body = JSON.stringify({ id: 'evt_late_1', type: 'payment.succeeded', providerRef: p!.providerRef, providerPaymentId: 'pi_late', amount: p!.amount });
    const r = await c.agent.post('/api/v1/payments/webhook/mock').set('content-type', 'application/json').set('x-mock-signature', mockSign(body)).send(body);
    expect(r.body.outcome).toBe('refund_late_payment');
    const o = await OrderModel.findById(res.body.order.id);
    expect(o?.status).toBe('CANCELLED');
    expect(o?.refundStatus).toBe('REFUNDED');
  });

  it('auto-rejects and refunds orders the restaurant ignores', async () => {
    const { orderId } = await paidOrder();
    await OrderModel.updateOne({ _id: orderId }, { $set: { confirmedAt: new Date(Date.now() - ACCEPT_TIMEOUT_MS - 1000) } });
    await autoRejectUnacceptedOrders();
    const o = await OrderModel.findById(orderId);
    expect(o?.status).toBe('REJECTED');
    expect(o?.refundStatus).toBe('REFUNDED');
  });

  it('customer refund request → admin partial approval → reconciled', async () => {
    const x = await paidOrder();
    for (const to of ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP']) await world.owner.post(`/merchant/orders/${x.orderId}/status`, { to });
    await world.partner.post(`/delivery/offers/${x.orderId}/accept`);
    await world.partner.post(`/delivery/orders/${x.orderId}/pickup`);
    const req = await x.c.post(`/orders/${x.orderId}/refund-requests`, { reason: 'missing_items', details: 'Raita was missing' });
    expect(req.status).toBe(201);
    expect((await x.c.post(`/orders/${x.orderId}/refund-requests`, { reason: 'other', details: 'again please' })).status).toBe(409);
    const ap = await world.admin.post(`/admin/refunds/${req.body.refund.id}/approve`, { amount: 3000, note: 'Raita refund' });
    expect(ap.status).toBe(200);
    expect(ap.body.refund.status).toBe('SUCCEEDED');
    const o = await OrderModel.findById(x.orderId);
    expect(o?.refundStatus).toBe('PARTIAL');
    expect(o?.refundedAmount).toBe(3000);
    const audit = await world.admin.get('/admin/audit');
    expect(audit.body.logs.map((l: { action: string }) => l.action)).toContain('refund.approve');
    // over-refunding is capped at what was captured
    const r2 = await RefundModel.create({ orderId: x.orderId, amount: 999999, kind: 'requested', reason: 'other', status: 'REQUESTED' });
    const ap2 = await world.admin.post(`/admin/refunds/${r2._id}/approve`, {});
    expect(ap2.body.refund.amount).toBe(x.total - 3000);
    expect((await OrderModel.findById(x.orderId))?.refundStatus).toBe('REFUNDED');
  });
});

describe('notification failures', () => {
  it('retries failed SMS with backoff, then marks FAILED and allows admin retry', async () => {
    const { orderId } = await paidOrder('9876500000'); // mock provider rejects numbers ending 0000
    await dispatchNotifications(50);
    let n = await NotificationModel.findOne({ orderId, event: 'PAYMENT_CONFIRMED' });
    expect(n?.status).toBe('PENDING');
    expect(n?.attempts).toBe(1);
    expect(n?.lastError).toMatch(/rejected/);
    expect(n!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await NotificationModel.updateOne({ _id: n!._id }, { $set: { nextAttemptAt: new Date(0) } });
      await dispatchNotifications(50);
    }
    n = await NotificationModel.findById(n!._id);
    expect(n?.status).toBe('FAILED');
    expect(n?.attempts).toBe(MAX_ATTEMPTS);

    const metrics = await world.admin.get('/admin/metrics');
    expect(metrics.body.failedNotifications).toBeGreaterThanOrEqual(1);
    expect((await world.admin.post(`/admin/notifications/${n!._id}/retry`)).status).toBe(200);
    expect((await NotificationModel.findById(n!._id))?.status).toBe('PENDING');
  });

  it('respects SMS opt-out', async () => {
    const { c, addressId } = await newCustomer(app);
    await c.patch('/users/me', { smsOptIn: false });
    const { res } = await placeOrder(c, rid, addressId, [paneerLine(String(world.items.paneer._id))]);
    await c.post(`/payments/mock/${res.body.payment.id}/simulate`, { outcome: 'success' });
    const n = await NotificationModel.findOne({ orderId: res.body.order.id, event: 'PAYMENT_CONFIRMED' });
    expect(n?.status).toBe('SKIPPED');
  });
});
