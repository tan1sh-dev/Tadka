import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Client, PASSWORD, newCustomer, paneerLine, placeOrder, seedWorld, setupApp } from './helpers';

let app: Express;
let world: Awaited<ReturnType<typeof seedWorld>>;

beforeAll(async () => {
  app = await setupApp();
  world = await seedWorld(app);
});

describe('health & auth', () => {
  it('reports health', async () => {
    const r = await new Client(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('registers, reads session, logs out', async () => {
    const c = await new Client(app).init();
    const r = await c.post('/auth/register', { name: 'Ravi K', email: 'ravi@test.dev', phone: '+91 98450 12345', password: PASSWORD });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ email: 'ravi@test.dev', phone: '+919845012345', role: 'customer' });
    expect(r.body.user.passwordHash).toBeUndefined();
    expect((await c.get('/auth/me')).body.user.email).toBe('ravi@test.dev');
    await c.post('/auth/logout');
    expect((await c.get('/auth/me')).body.user).toBeNull();
  });

  it('cannot self-register as admin', async () => {
    const c = await new Client(app).init();
    const r = await c.post('/auth/register', { name: 'Eve', email: 'eve@test.dev', phone: '9876500000', password: PASSWORD, role: 'admin' });
    expect(r.status).toBe(400);
  });

  it('rejects duplicate emails and wrong passwords with generic errors', async () => {
    const c = await new Client(app).init();
    expect((await c.post('/auth/register', { name: 'Ravi K', email: 'ravi@test.dev', phone: '9845012345', password: PASSWORD })).status).toBe(409);
    const bad = await c.post('/auth/login', { email: 'ravi@test.dev', password: 'nope-nope' });
    expect(bad.status).toBe(401);
    const unknown = await c.post('/auth/login', { email: 'ghost@test.dev', password: 'nope-nope' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);
  });

  it('enforces CSRF on state-changing requests', async () => {
    const c = await new Client(app).init();
    const r = await c.agent.post('/api/v1/auth/login').send({ email: 'ravi@test.dev', password: PASSWORD });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF');
  });

  it('rejects NoSQL operator injection', async () => {
    const c = await new Client(app).init();
    const r = await c.post('/auth/login', { email: { $gt: '' }, password: { $gt: '' } });
    expect(r.status).toBe(400);
  });

  it('revokes sessions when an admin suspends a user', async () => {
    const { c, userId } = await newCustomer(app);
    expect((await c.get('/orders')).status).toBe(200);
    expect((await world.admin.patch(`/admin/users/${userId}`, { status: 'suspended' })).status).toBe(200);
    expect((await c.get('/orders')).status).toBe(401);
  });
});

describe('role & resource authorisation', () => {
  it('blocks anonymous and wrong-role access', async () => {
    const anon = await new Client(app).init();
    expect((await anon.get('/orders')).status).toBe(401);
    const { c } = await newCustomer(app);
    expect((await c.get('/admin/metrics')).status).toBe(403);
    expect((await c.get('/merchant/orders')).status).toBe(403);
    expect((await c.get('/delivery/me')).status).toBe(403);
    expect((await world.owner.get('/admin/metrics')).status).toBe(403);
    expect((await world.partner.get('/merchant/menu')).status).toBe(403);
  });

  it("hides other customers' orders and addresses", async () => {
    const a = await newCustomer(app);
    const b = await newCustomer(app);
    const { res } = await placeOrder(a.c, String(world.restaurant._id), a.addressId, [paneerLine(String(world.items.paneer._id))]);
    expect(res.status).toBe(201);
    const orderId = res.body.order.id;
    expect((await b.c.get(`/orders/${orderId}`)).status).toBe(404);
    expect((await b.c.post(`/orders/${orderId}/cancel`)).status).toBe(404);
    expect((await b.c.del(`/addresses/${a.addressId}`)).status).toBe(404);
    // b cannot use a's address to order
    const steal = await b.c.post('/carts/quote', { restaurantId: String(world.restaurant._id), addressId: a.addressId, lines: [paneerLine(String(world.items.paneer._id))] });
    expect(steal.status).toBe(404);
    // b cannot pay a's payment via the mock gateway
    expect((await b.c.post(`/payments/mock/${res.body.payment.id}/simulate`, { outcome: 'success' })).status).toBe(404);
    // unassigned partner cannot see the order
    expect((await world.partner.get(`/orders/${orderId}`)).status).toBe(404);
  });

  it('restaurant owners cannot act on other restaurants’ orders', async () => {
    const { c, addressId } = await newCustomer(app);
    const { res } = await placeOrder(c, String(world.restaurant._id), addressId, [paneerLine(String(world.items.paneer._id))]);
    const other = await new Client(app).init();
    await other.post('/auth/register', { name: 'Other Owner', email: 'other-owner@test.dev', phone: '9800000001', password: PASSWORD, role: 'restaurant' });
    expect((await other.post(`/merchant/orders/${res.body.order.id}/status`, { to: 'ACCEPTED' })).status).toBe(404);
  });
});
