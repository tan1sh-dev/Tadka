import { io, type Socket } from 'socket.io-client';
import { useEffect, useState } from 'react';

let socket: Socket | null = null;

/** One authenticated socket per tab (session cookie is sent automatically on the same origin). */
export function getSocket(): Socket {
  socket ??= io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
  return socket;
}

export function resetSocket() {
  socket?.disconnect();
  socket = null;
}

export function useSocketStatus() {
  const [connected, setConnected] = useState(() => getSocket().connected);
  useEffect(() => {
    const s = getSocket();
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    s.on('connect', on);
    s.on('disconnect', off);
    s.on('connect_error', off);
    return () => {
      s.off('connect', on);
      s.off('disconnect', off);
      s.off('connect_error', off);
    };
  }, []);
  return connected;
}
