import { Link, Navigate } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronRight, Receipt } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDateTime, inr } from '../../lib/format';
import { useMe } from '../../hooks/useAuth';
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import { STATUS_LABELS, type OrderStatus } from '@tadka/shared';

interface Row {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  restaurantName: string;
  summary: string;
  total: number;
  createdAt: string;
  reviewed: boolean;
  refundStatus: string;
}

export function statusTone(s: OrderStatus) {
  if (s === 'DELIVERED') return 'leaf' as const;
  if (['CANCELLED', 'REJECTED', 'PAYMENT_FAILED'].includes(s)) return 'chili' as const;
  if (s === 'PAYMENT_PENDING') return 'turmeric' as const;
  return 'brand' as const;
}

export function OrdersPage() {
  const { data: me, isLoading } = useMe();
  const q = useInfiniteQuery({
    queryKey: ['orders'],
    queryFn: ({ pageParam }) => api<{ orders: Row[]; hasMore: boolean }>(`/orders?page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
    enabled: me?.role === 'customer',
  });
  if (isLoading) return null;
  if (!me) return <Navigate to="/login?next=/orders" replace />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const rows = q.data?.pages.flatMap((p) => p.orders) ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-5 text-2xl font-extrabold sm:text-3xl">Your orders</h1>
      {q.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Receipt />} title="No orders yet" body="When you order, you’ll be able to track it and reorder from here." action={<Link to="/" className="font-semibold text-brand-700 underline">Find food</Link>} />
      ) : (
        <ul className="space-y-3">
          {rows.map((o) => (
            <li key={o.id}>
              <Link to={`/orders/${o.id}`} className="card flex items-center gap-4 p-4 hover:shadow-[var(--shadow-pop)]">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{o.restaurantName}</p>
                    <Badge tone={statusTone(o.status)}>{STATUS_LABELS[o.status]}</Badge>
                    {o.refundStatus !== 'NONE' && <Badge tone="turmeric">Refund {o.refundStatus.toLowerCase()}</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-1 text-sm text-muted">{o.summary}</p>
                  <p className="mt-1 text-xs text-muted">
                    {o.orderNumber} · {formatDateTime(o.createdAt)} · <span className="num font-semibold text-ink">{inr(o.total)}</span>
                    {o.status === 'DELIVERED' && !o.reviewed && <span className="font-semibold text-brand-700"> · Rate this order</span>}
                  </p>
                </div>
                <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <div className="mt-4 text-center">
          <Button variant="secondary" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
