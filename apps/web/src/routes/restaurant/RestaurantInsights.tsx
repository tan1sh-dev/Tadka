import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatDate, inr } from '../../lib/format';
import { EmptyState, ErrorState, PageHeader, Select, Spinner, Stat } from '../../components/ui';

interface Analytics {
  days: number;
  orders: { delivered: number; rejected: number; cancelled: number };
  acceptanceRate: number | null;
  avgPrepMinutes: number | null;
  money: { itemTotal: number; packaging: number; commission: number; gstOnCommission: number; net: number; commissionRateBps: number | null };
  topItems: { name: string; qty: number; revenue: number }[];
  daily: { date: string; orders: number; gmv: number }[];
}

export function RestaurantInsightsPage() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['merchant', 'analytics', days], queryFn: () => api<Analytics>(`/merchant/analytics?days=${days}`) });
  const payouts = useQuery({
    queryKey: ['merchant', 'payouts'],
    queryFn: () => api<{ payouts: { id: string; periodStart: string; periodEnd: string; orders: number; net: number; commission: number; status: string }[] }>('/merchant/payouts').then((r) => r.payouts),
  });
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const a = q.data;
  const max = Math.max(1, ...a.daily.map((d) => d.gmv));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Insights"
        sub="Delivered orders only. Figures in INR."
        actions={
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className="h-9 w-auto">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </Select>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Delivered orders" value={a.orders.delivered} sub={`${a.orders.rejected} rejected · ${a.orders.cancelled} cancelled`} />
        <Stat label="Food sales" value={inr(a.money.itemTotal, true)} />
        <Stat label="Acceptance rate" value={a.acceptanceRate === null ? '—' : `${a.acceptanceRate}%`} />
        <Stat label="Avg. prep time" value={a.avgPrepMinutes === null ? '—' : `${a.avgPrepMinutes} min`} sub="Accept → ready. Used for customer ETAs" />
      </div>

      <section className="card p-5" aria-labelledby="payout-h">
        <h2 id="payout-h" className="text-lg font-bold">
          Where your money goes
        </h2>
        <p className="text-sm text-muted">The exact deductions for this period. No hidden adjustments.</p>
        <dl className="mt-4 max-w-md space-y-2 text-sm">
          {[
            ['Food sales', a.money.itemTotal],
            ['Packaging charges collected', a.money.packaging],
            [`Platform commission${a.money.commissionRateBps !== null ? ` (${a.money.commissionRateBps / 100}%)` : ''}`, -a.money.commission],
            ['GST on commission (18%)', -a.money.gstOnCommission],
          ].map(([l, v]) => (
            <div key={l as string} className="flex justify-between">
              <dt className="text-ink-2">{l}</dt>
              <dd className="num">{(v as number) < 0 ? `− ${inr(-(v as number))}` : inr(v as number)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-line pt-2 font-bold">
            <dt>Net payable to you</dt>
            <dd className="num">{inr(a.money.net)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted">Coupons are funded by Tadka in this version and never reduce your payout.</p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 text-lg font-bold">Daily sales</h2>
          {a.daily.length === 0 ? (
            <EmptyState title="No delivered orders in this period" />
          ) : (
            <ul className="space-y-2" aria-label="Daily food sales">
              {a.daily.map((d) => (
                <li key={d.date} className="grid grid-cols-[70px_1fr_80px] items-center gap-3 text-xs">
                  <span className="text-muted">{formatDate(d.date).replace(/ \d{4}$/, '')}</span>
                  <span className="h-2.5 rounded-full bg-line">
                    <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(d.gmv / max) * 100}%` }} />
                  </span>
                  <span className="num text-right font-semibold">
                    {inr(d.gmv, true)} · {d.orders}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5">
          <h2 className="mb-4 text-lg font-bold">Most ordered</h2>
          {a.topItems.length === 0 ? (
            <EmptyState title="No data yet" />
          ) : (
            <ol className="space-y-2 text-sm">
              {a.topItems.map((t, i) => (
                <li key={t.name} className="flex items-center gap-3">
                  <span className="num grid size-6 place-items-center rounded-full bg-paper text-xs font-bold">{i + 1}</span>
                  <span className="flex-1">{t.name}</span>
                  <span className="num text-muted">{t.qty} sold</span>
                  <span className="num w-20 text-right font-semibold">{inr(t.revenue, true)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="card p-5">
        <h2 className="mb-3 text-lg font-bold">Payout statements</h2>
        {!payouts.data?.length ? (
          <p className="text-sm text-muted">Statements appear here once the platform generates them for a period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="py-2">Period</th>
                <th>Orders</th>
                <th className="text-right">Commission</th>
                <th className="text-right">Net</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payouts.data.map((p) => (
                <tr key={p.id}>
                  <td className="py-2">
                    {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                  </td>
                  <td>{p.orders}</td>
                  <td className="num text-right">{inr(p.commission)}</td>
                  <td className="num text-right font-semibold">{inr(p.net)}</td>
                  <td className="text-right">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
