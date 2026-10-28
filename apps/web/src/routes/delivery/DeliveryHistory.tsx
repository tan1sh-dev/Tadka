import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatDateTime, inr } from '../../lib/format';
import { EmptyState, ErrorState, PageHeader, Spinner, Stat } from '../../components/ui';

interface History {
  deliveries: { orderId: string; orderNumber: string; restaurant: string; dropLocality: string; distanceKm: number; earnings: { base: number; distancePay: number; total: number }; deliveredAt: string; durationMin: number | null }[];
  summary: { lifetime: number; last7Days: number; count: number };
}

export function DeliveryHistoryPage() {
  const q = useQuery({ queryKey: ['delivery', 'history'], queryFn: () => api<History>('/delivery/history') });
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const { deliveries, summary } = q.data;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Earnings" sub="Per delivery: ₹25 base + ₹8 per km (restaurant → customer). Shown before you accept." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Last 7 days" value={inr(summary.last7Days)} />
        <Stat label="Lifetime" value={inr(summary.lifetime)} />
        <Stat label="Deliveries" value={summary.count} />
      </div>
      {deliveries.length === 0 ? (
        <EmptyState title="No completed deliveries yet" />
      ) : (
        <ul className="card divide-y divide-line">
          {deliveries.map((d) => (
            <li key={d.orderId} className="flex items-center gap-4 p-4 text-sm">
              <div className="flex-1">
                <p className="font-semibold">
                  {d.restaurant} → {d.dropLocality}
                </p>
                <p className="text-xs text-muted">
                  {d.orderNumber} · {formatDateTime(d.deliveredAt)} · {d.distanceKm} km{d.durationMin ? ` · ${d.durationMin} min` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="num font-bold text-leaf-700">{inr(d.earnings.total)}</p>
                <p className="num text-xs text-muted">
                  {inr(d.earnings.base)} + {inr(d.earnings.distancePay)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
