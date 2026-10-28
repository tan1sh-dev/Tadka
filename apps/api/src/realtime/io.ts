import type { Server } from 'socket.io';

/**
 * Thin emitter used by domain services. Emits only after a transaction commits,
 * so clients never see a state that was rolled back. No-op until the socket server starts.
 */
let io: Server | null = null;

export function setIo(server: Server | null) {
  io = server;
}

export const rooms = {
  order: (id: string) => `order:${id}`,
  restaurant: (id: string) => `restaurant:${id}`,
  partner: (userId: string) => `partner:${userId}`,
  user: (userId: string) => `user:${userId}`,
  admin: 'admin',
};

export function emit(room: string | string[], event: string, payload: unknown) {
  if (!io) return;
  io.to(room).emit(event, payload);
}
