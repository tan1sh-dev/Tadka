import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { mockSign } from '../src/modules/payments/payment.provider';
import { dispatchNotifications } from '../src/modules/notifications/notifications.service';
import { NotificationModel } from '../src/models/ops';
import { OrderModel } from '../src/models/order';
import { NEAR_KORAMANGALA, newCustomer, paneerLine, placeOrder, seedWorld, setupApp } from './helpers';

let app: Express;
let world: Awaited<ReturnType<typeof seedWorld>>;
let rid: string;

beforeAll(async () => {
  app = await setupApp();
  world = await seedWorld(app);
  rid = String(world.restaurant._id);
});

describe('Honest Price quote (server-authoritative)', () => {
  it('prices from the database and itemises every fee', async () => {
    const { c, addressId } = await newCustomer(app);
    const r = await c.post('/carts/quote', { restaurantId: rid, addressId, lines: [paneerLine(String(world.items.paneer._id), 2)] });
    expect(r.status).toBe(200);
    expect(r.body.quote.itemTotal).toBe(2 * (25000 + 10000));
    expect(r.body.quote.breakdown.reduce((s: number, l: { amount: number }) => s + l.amount, 0)).toBe(r.body.quote.total);
    expect(r.body.canOrder).toBe(true);
  });

  it('ignores any client-sent price fields', async () => {
    const { c, addressId } = await newCustomer(app);
    const r = await c.post('/carts/quote', {
      restaurantId: rid,
      addressId,
      lines: [{ ...paneerLine(String(world.items.paneer._id)), price: 1, unitPrice: 1 }],
    });
    expect(r.body.quote.itemTotal).toBe(35000);
  });

  it('reports blockers: sold-out items, bad customisation, unserviceable address', async () => {
    const { c } = await newCustomer(app);
    const r = await c.post('/carts/quote', {
      restaurantId: rid,
      location: { lat: 13.2, lng: 77.7 },
      lines: [
        { menuItemId: String(world.items.soldOut._id), quantity: 1 },
        { menuItemId: String(world.items.paneer._id), quantity: 1, selections: [] },
      ],
    });
    const codes = r.body.blockers.map((b: { code: string }) => b.code);
    expect(codes).toEqual(expect.arrayContaining(['ITEM_UNAVAILABLE', 'INVALID_SELECTION', 'NOT_SERVICEABLE']));
    expect(r.body.canOrder).toBe(false);
  });

  it('Dietary Guard blocks conflicting items, including non-veg add-ons', async () => {
    const { c, addressId } = await newCustomer(app);
    await c.patch('/users/me', { dietary: { enabled: true, diet: 'veg', avoidAllergens: ['dairy'] } });
    const r = await c.post('/carts/quote', {
      restaurantId: rid,
      addressId,
      lines: [
        { menuItemId: String(world.items.paneer._id), quantity: 1, selections: [{ groupId: 'size', optionIds: ['half'] }, { groupId: 'addons', optionIds: ['chicken65', 'raita'] }] },
      ],
    });
    const conflict = r.body.blockers.find((b: { code: string }) => b.code === 'DIETARY_CONFLICT');
    expect(conflict.message).toMatch(/meat or fish/);
    expect(conflict.message).toMatch(/dairy/);
    // and the server refuses to create the order even if the client ignores the warning
    const o = await c.post('/orders', { restaurantId: rid, addressId, lines: [{ menuItemId: String(world.items.chicken._id), quantity: 1 }], expectedTotal: 1 }, { 'Idempotency-Key': 'diet-guard-test-1' });
    expect(o.status).toBe(422);
    expect(o.body.error.code).toBe('DIETARY_CONFLICT');
    // menu marks the conflict too
    const menu = await c.get(`/restaurants/${world.restaurant.slug}`);
    const chicken = menu.body.items.find((i: { name: string }) => i.name === 'Chicken Biryani');
    expect(chicken.dietary.ok).toBe(false);
  });

  it('validates coupons: expired and minimum order', async () => {
    const { c, addressId } = await newCustomer(app);
    const expired = await c.post('/carts/quote', { restaurantId: rid, addressId, lines: [paneerLine(String(world.items.paneer._id))], couponCode: 'OLDDEAL' });
    expect(expired.body.couponError.code).toBe('EXPIRED');
    const small = await c.post('/carts/quote', {
      restaurantId: rid,
      addressId,
      lines: [{ menuItemId: String(world.items.paneer._id), quantity: 1, selections: [{ groupId: 'size', optionIds: ['half'] }] }],
      couponCode: 'SAVE50',
    });
    expect(small.body.couponError.code).toBe('MIN_ORDER');
  });
});

describe('order creation and payments', () => {
  it('rejects a stale expected total with PRICE_CHANGED and the new quote', async () => {
    const { c, addressId } = await newCustomer(app);
    const r = await c.post('/orders', { restaurantId: rid, addressId, lines: [paneerLine(String(world.items.paneer._id))], expectedTotal: 100 }, { 'Idempotency-Key': 'price-change-1' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PRICE_CHANGED');
    expect(r.body.error.details.quote.total).toBeGreaterThan(100);
  });

  it('is idempotent on the Idempotency-Key header', async () => {
    const { c, addressId } = await newCustomer(app);
    const { res, key, quote } = await placeOrder(c, rid, addressId, [paneerLine(String(world.items.paneer._id))]);
    expect(res.status).toBe(201);
    const again = await c.post('/orders', { restaurantId: rid, addressId, lines: [paneerLine(String(world.items.paneer._id))], expectedTotal: quote.quote.total }, { 'Idempotency-Key': key });
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.order.id).toBe(res.body.order.id);
    expect(await OrderModel.countDocuments({ idempotencyKey: key })).toBe(1);
  });

  it('confirms only via a verified webhook; duplicates and bad signatures are harmless', async () => {
    const { c, addressId } = await newCustomer(app);
    const { res } = await placeOrder(c, rid, addressId, [paneerLine(String(world.items.paneer._id))], 'SAVE50');
    expect(res.body.order.status).toBe('PAYMENT_PENDING');
    expect(res.body.order.coupon).toMatchObject({ code: 'SAVE50', discount: 5000 });
    const orderId = res.body.order.id;
    const payment = (await c.get(`/payments/${res.body.payment.id}`)).body.payment;

    const body = JSON.stringify({ id: 'evt_dup_1', type: 'payment.succeeded', providerRef: `mock_cs_${payment.id}`, amount: payment.amount });
    const forged = await c.agent.post('/api/v1/payments/webhook/mock').set('content-type', 'application/json').set('x-mock-signature', 'deadbeef').send(body);
    expect(forged.status).toBe(400);
    expect((await c.get(`/orders/${orderId}`)).body.order.status).toBe('PAYMENT_PENDING');

    const send = () => c.agent.post('/api/v1/payments/webhook/mock').set('content-type', 'application/json').set('x-mock-signature', mockSign(body)).send(body);
    const first = await send();
    const second = await send();
    expect(first.body.outcome).toBe('processed');
    expect(second.body.outcome).toBe('duplicate');

    const o = (await c.get(`/orders/${orderId}`)).body.order;
    expect(o.status).toBe('CONFIRMED');
    expect(o.timeline.filter((t: { status: string }) => t.status === 'CONFIRMED')).toHaveLength(1);
    expect(o.promisedEta.minMinutes).toBeGreaterThan(0);

    // a second event id for the same payment is stale, not a second confirmation
    const body2 = JSON.stringify({ id: 'evt_dup_2', type: 'payment.succeeded', providerRef: `mock_cs_${payment.id}`, amount: payment.amount });
    const third = await c.agent.post('/api/v1/payments/webhook/mock').set('content-type', 'application/json').set('x-mock-signature', mockSign(body2)).send(body2);
    expect(third.body.outcome).toBe('stale');

    // the coupon was redeemed once and cannot be reused by the same customer
    const reuse = await c.post('/carts/quote', { restaurantId: rid, addressId, lines: [paneerLine(String(world.items.paneer._id))], couponCode: 'SAVE50' });
    expect(reuse.body.couponError.code).toBe('PER_USER_LIMIT');
  });

  it('refuses to confirm when the paid amount does not match', async () => {
    const { c, addressId } = await newCustomer(app);
    const { res } = await placeOrder(c, rid, addressId, [paneerLine(String(world.items.paneer._id))]);
    const body = JSON.stringify({ id: 'evt_amount_1', type: 'payment.succeeded', providerRef: `mock_cs_${res.body.payment.id}`, amount: 1 });
    const r = await c.agent.post('/api/v1/payments/webhook/mock').set('content-type', 'application/json').set('x-mock-signature', mockSign(body)).send(body);
    expect(r.body.outcome).toBe('amount_mismatch');
    expect((await c.get(`/orders/${res.body.order.id}`)).body.order.status).toBe('PAYMENT_PENDING');
  });

  it('handles payment failure, then a successful retry', async () => {
    const { c, addressId } = await newCustomer(app);
    const { res } = await placeOrder(c, rid, addressId, [paneerLine(String(world.items.paneer._id))]);
    const orderId = res.body.order.id;
    await c.post(`/payments/mock/${res.body.payment.id}/simulate`, { outcome: 'failure' });
    expect((await c.get(`/orders/${orderId}`)).body.order.status).toBe('PAYMENT_FAILED');
    // customers cannot "confirm" by themselves
    expect((await c.post(`/orders/${orderId}/cancel`)).status).toBe(200);
  });

  it('retry creates a new attempt and only that attempt confirms the order', async () => {
    const { c, addressId } = await newCustomer(app);
    const { res } = await placeOrder(c, rid, addressId, [paneerLine(String(world.items.paneer._id))]);
    const orderId = res.body.order.id;
    await c.post(`/payments/mock/${res.body.payment.id}/simulate`, { outcome: 'failure' });
    const retry = await c.post(`/orders/${orderId}/payment/retry`);
    expect(retry.status).toBe(200);
    expect(retry.body.payment.id).not.toBe(res.body.payment.id);
    await c.post(`/payments/mock/${retry.body.payment.id}/simulate`, { outcome: 'success' });
    expect((await c.get(`/orders/${orderId}`)).body.order.status).toBe('CONFIRMED');
  });
});

describe('end-to-end lifecycle: restaurant → partner → delivered → review', () => {
  it('runs the happy path with live location and OTP', async () => {
    const { c, addressId } = await newCustomer(app);
    const { res } = await placeOrder(c, rid, addressId, [paneerLine(String(world.items.paneer._id))], undefined);
    const orderId = res.body.order.id;
    await c.post(`/payments/mock/${res.body.payment.id}/simulate`, { outcome: 'success' });

    // restaurant sees it in the queue
    const queue = await world.owner.get('/merchant/orders?view=active');
    expect(queue.body.orders.map((o: { id: string }) => o.id)).toContain(orderId);
    expect(queue.body.orders[0].deliveryAddress).toBeUndefined(); // least privilege

    // invalid jump is refused
    const skip = await world.owner.post(`/merchant/orders/${orderId}/status`, { to: 'READY_FOR_PICKUP' });
    expect(skip.status).toBe(409);

    expect((await world.owner.post(`/merchant/orders/${orderId}/status`, { to: 'ACCEPTED' })).status).toBe(200);

    // nearest online partner gets the offer
    const me = await world.partner.get('/delivery/me');
    expect(me.body.offers.map((o: { orderId: string }) => o.orderId)).toContain(orderId);
    expect((await world.partner.post(`/delivery/offers/${orderId}/accept`)).status).toBe(200);

    await world.owner.post(`/merchant/orders/${orderId}/status`, { to: 'PREPARING' });
    // partner cannot pick up before food is ready
    expect((await world.partner.post(`/delivery/orders/${orderId}/pickup`)).status).toBe(409);
    await world.owner.post(`/merchant/orders/${orderId}/status`, { to: 'READY_FOR_PICKUP' });
    expect((await world.partner.post(`/delivery/orders/${orderId}/pickup`)).status).toBe(200);
    expect((await world.partner.post(`/delivery/orders/${orderId}/start`)).status).toBe(200);

    // location: accepted from the assigned partner, visible to the customer
    const loc = await world.partner.post('/delivery/location', { orderId, ...NEAR_KORAMANGALA, accuracy: 12, recordedAt: Date.now() });
    expect(loc.body).toEqual({ accepted: true });
    const tracked = (await c.get(`/orders/${orderId}`)).body.order;
    expect(tracked.delivery.lastLocation).toMatchObject({ lat: NEAR_KORAMANGALA.lat, source: 'gps' });
    expect(tracked.eta.confidence).toBe('high');
    // stale and implausible updates are refused
    const stale = await world.partner.post('/delivery/location', { orderId, ...NEAR_KORAMANGALA, recordedAt: Date.now() - 10 * 60_000 });
    expect(stale.body.reason).toBe('stale_or_future_timestamp');

    // partner never sees the OTP; customer does
    expect((await world.partner.get(`/orders/${orderId}`)).body.order.deliveryOtp).toBeUndefined();
    const otp = tracked.deliveryOtp as string;
    expect(otp).toMatch(/^\d{4}$/);
    const wrong = await world.partner.post(`/delivery/orders/${orderId}/deliver`, { otp: otp === '1111' ? '2222' : '1111' });
    expect(wrong.status).toBe(422);
    const done = await world.partner.post(`/delivery/orders/${orderId}/deliver`, { otp });
    expect(done.status).toBe(200);
    expect(done.body.order.status).toBe('DELIVERED');

    // location after delivery is rejected (tracking stops)
    const after = await world.partner.post('/delivery/location', { orderId, ...NEAR_KORAMANGALA, recordedAt: Date.now() + 5000 });
    expect(after.body.reason).toBe('not_assigned');

    // review + rating update
    expect((await c.post(`/orders/${orderId}/review`, { foodRating: 5, deliveryRating: 4, comment: 'Great' })).status).toBe(201);
    expect((await c.post(`/orders/${orderId}/review`, { foodRating: 1 })).status).toBe(409);
    const menu = await c.get(`/restaurants/${world.restaurant.slug}`);
    expect(menu.body.restaurant.rating.count).toBeGreaterThanOrEqual(1);

    // history + earnings
    const hist = await world.partner.get('/delivery/history');
    expect(hist.body.deliveries[0].earnings.total).toBeGreaterThan(0);

    // admin can inspect the full operational history
    const adm = await world.admin.get(`/admin/orders/${orderId}`);
    expect(adm.status).toBe(200);
    expect(adm.body.order.timeline.map((t: { status: string }) => t.status)).toEqual([
      'PAYMENT_PENDING',
      'CONFIRMED',
      'ACCEPTED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'PICKED_UP',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ]);
    const events = adm.body.notifications.map((n: { event: string }) => n.event);
    expect(events).toEqual(expect.arrayContaining(['PAYMENT_CONFIRMED', 'ORDER_ACCEPTED', 'PARTNER_ASSIGNED', 'ORDER_PICKED_UP', 'ORDER_DELIVERED']));
    expect(adm.body.notifications[0].to).not.toContain('98765'); // masked

    // notifications dispatch through the mock provider
    await dispatchNotifications(50);
    expect(await NotificationModel.countDocuments({ orderId, status: 'SENT', provider: 'mock' })).toBeGreaterThanOrEqual(5);

    // restaurant analytics include commission transparency
    const an = await world.owner.get('/merchant/analytics');
    expect(an.body.money.commission).toBeGreaterThan(0);
    expect(an.body.money.net).toBe(an.body.money.itemTotal + an.body.money.packaging - an.body.money.commission - an.body.money.gstOnCommission);
  });
});
