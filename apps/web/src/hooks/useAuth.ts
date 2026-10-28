import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '../lib/api';
import { resetSocket } from '../lib/socket';
import type { Me } from '../lib/types';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: Me | null }>('/auth/me').then((r) => r.user),
    staleTime: 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    resetSocket();
    qc.clear();
    window.location.assign('/');
  }, [qc]);
}

export function homeFor(role: Me['role'] | undefined) {
  switch (role) {
    case 'restaurant':
      return '/partner/restaurant';
    case 'delivery':
      return '/partner/delivery';
    case 'admin':
      return '/admin';
    default:
      return '/';
  }
}
