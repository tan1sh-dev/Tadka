import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env, isProd } from '../config/env';
import { logger } from '../lib/logger';
import { SESSION_COOKIE, resolveSession, type AuthUser } from '../middleware/auth';
import { RestaurantModel } from '../models/restaurant';
import { handleLocationUpdate } from '../modules/delivery/delivery.service';
import { orderViewerRole } from '../modules/orders/orders.access';
import { rooms, setIo } from './io';

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

type Ack = (r: unknown) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => undefined);

/**
 * Socket.IO protocol (documented in docs/api.md):
 *  auth: session cookie (same as REST). Origin must match WEB_ORIGIN in production.
 *  auto-joined rooms: user:<id>; restaurant:<id> (owners); partner:<userId> (partners); admin (admins)
 *  client → server: order:subscribe {orderId}, order:unsubscribe {orderId}, location:update {...}
 *  server → client: order:updated, order:new, order:location, delivery:offer, delivery:cancelled
 */
export function attachSocketServer(http: HttpServer): Server {
  const io = new Server(http, {
    cors: { origin: env.WEB_ORIGIN, credentials: true },
    pingInterval: 20_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 16_000,
  });

  io.use(async (socket, next) => {
    if (isProd && socket.handshake.headers.origin !== env.WEB_ORIGIN) return next(new Error('forbidden_origin'));
    const user = await resolveSession(readCookie(socket.handshake.headers.cookie, SESSION_COOKIE)).catch(() => null);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user as AuthUser;
    await socket.join(rooms.user(user.id));
    if (user.role === 'admin') await socket.join(rooms.admin);
    if (user.role === 'delivery') await socket.join(rooms.partner(user.id));
    if (user.role === 'restaurant') {
      const r = await RestaurantModel.findOne({ ownerId: user.id }).select('_id').lean();
      if (r) await socket.join(rooms.restaurant(String(r._id)));
    }

    socket.on('order:subscribe', async (payload: { orderId?: unknown }, ack) => {
      const orderId = typeof payload?.orderId === 'string' ? payload.orderId : '';
      const role = await orderViewerRole(user, orderId).catch(() => null);
      if (!role) return safeAck(ack)({ ok: false, error: 'not_found' });
      await socket.join(rooms.order(orderId));
      safeAck(ack)({ ok: true });
    });

    socket.on('order:unsubscribe', async (payload: { orderId?: unknown }) => {
      if (typeof payload?.orderId === 'string') await socket.leave(rooms.order(payload.orderId));
    });

    socket.on('location:update', async (payload, ack) => {
      if (user.role !== 'delivery') return safeAck(ack)({ accepted: false, reason: 'forbidden' });
      try {
        safeAck(ack)(await handleLocationUpdate(user.id, payload));
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'location:update failed');
        safeAck(ack)({ accepted: false, reason: 'server_error' });
      }
    });
  });

  setIo(io);
  return io;
}
