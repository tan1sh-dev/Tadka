import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { io as ioc, type Socket } from 'socket.io-client';
import { CookieAccessInfo } from 'cookiejar';
import { attachSocketServer } from '../src/realtime/socket';
import { NEAR_KORAMANGALA, newCustomer, paneerLine, placeOrder, seedWorld, setupApp, type Client } from './helpers';

let app: Express;
let world: Awaited<ReturnType<typeof seedWorld>>;
let server: http.Server;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  app = await setupApp();
  world = await seedWorld(app);
  server = http.createServer(app);
  attachSocketServer(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  sockets.forEach((s) => s.close());
  await new Promise((r) => server.close(r));
});

function cookieOf(c: Client) {
  return c.agent.jar.getCookies(CookieAccessInfo.All).map((k) => `${k.name}=${k.value}`).join('; ');
}

function connect(c: Client | null): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioc(url, { transports: ['websocket'], extraHeaders: c ? { cookie: cookieOf(c) } : {}, reconnection: false });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
  });
}

const once = <T>(s: Socket, ev: string) => new Promise<T>((r) => s.once(ev, r));

describe('Socket.IO tracking', () => {
  it('rejects unauthenticated sockets', async () => {
    await expect(connect(null)).rejects.toThrow(/unauthorized/);
  });

  it('streams authorised location updates only to subscribers of that order', async () => {
    const cust = await newCustomer(app);
    const other = await newCustomer(app);
    const { res } = await placeOrder(cust.c, String(world.restaurant._id), cust.addressId, [paneerLine(String(world.items.paneer._id))]);
    const orderId = res.body.order.id;
    await cust.c.post(`/payments/mock/${res.body.payment.id}/simulate`, { outcome: 'success' });
    await world.owner.post(`/merchant/orders/${orderId}/status`, { to: 'ACCEPTED' });
    await world.partner.post(`/delivery/offers/${orderId}/accept`);

    const custSock = await connect(cust.c);
    const otherSock = await connect(other.c);
    const partnerSock = await connect(world.partner);

    expect(await custSock.emitWithAck('order:subscribe', { orderId })).toEqual({ ok: true });
    expect(await otherSock.emitWithAck('order:subscribe', { orderId })).toEqual({ ok: false, error: 'not_found' });

    let leaked = false;
    otherSock.on('order:location', () => (leaked = true));

    const got = once<{ lat: number; source: string; at: string }>(custSock, 'order:location');
    const ack = await partnerSock.emitWithAck('location:update', { orderId, ...NEAR_KORAMANGALA, accuracy: 10, recordedAt: Date.now(), source: 'gps' });
    expect(ack).toEqual({ accepted: true });
    const msg = await got;
    expect(msg.lat).toBe(NEAR_KORAMANGALA.lat);
    expect(msg.source).toBe('gps');

    // customers cannot publish locations
    expect(await custSock.emitWithAck('location:update', { orderId, ...NEAR_KORAMANGALA, recordedAt: Date.now() })).toEqual({
      accepted: false,
      reason: 'forbidden',
    });

    // status changes are pushed
    const upd = once<{ status: string }>(custSock, 'order:updated');
    await world.owner.post(`/merchant/orders/${orderId}/status`, { to: 'PREPARING' });
    expect((await upd).status).toBe('PREPARING');
    expect(leaked).toBe(false);

    await world.admin.post(`/admin/orders/${orderId}/cancel`, { reason: 'test cleanup' });
  });
});
