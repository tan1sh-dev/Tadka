import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, FlaskConical } from 'lucide-react';
import { api } from '../../lib/api';
import { errorMessage, inr } from '../../lib/format';
import { Button, ErrorState, Notice, Spinner } from '../../components/ui';

interface PaymentInfo {
  payment: { id: string; orderId: string; status: string; amount: number; provider: string; failureReason: string };
  order: { orderNumber: string; status: string; restaurant: string };
}

/**
 * Development-only payment page for the mock provider. Its buttons ask the API to emit a signed provider event,
 * which goes through the same webhook pipeline as Stripe. Nothing here confirms an order by itself.
 */
export function MockPayPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [busy, setBusy] = useState<'success' | 'failure' | null>(null);
  const [error, setError] = useState('');
  const q = useQuery({ queryKey: ['payment', id], queryFn: () => api<PaymentInfo>(`/payments/${id}`) });

  async function simulate(outcome: 'success' | 'failure') {
    setBusy(outcome);
    setError('');
    try {
      await api(`/payments/mock/${id}/simulate`, { method: 'POST', body: { outcome } });
      nav(`/orders/${q.data!.payment.orderId}?payment=return`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (q.isError) return <ErrorState error={q.error} />;
  if (!q.data) return <Spinner label="Opening payment" />;
  const { payment, order } = q.data;
  const payable = ['CREATED', 'PENDING'].includes(payment.status);

  return (
    <div className="mx-auto max-w-md space-y-4 pt-4">
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-turmeric-600 bg-turmeric-100 px-3 py-2 text-sm font-semibold text-turmeric-600">
        <FlaskConical className="size-4" aria-hidden /> Test payment gateway: no real money moves
      </div>
      <section className="card p-6">
        <p className="label">Paying Tadka</p>
        <p className="num mt-1 font-display text-4xl font-extrabold">{inr(payment.amount)}</p>
        <p className="mt-1 text-sm text-muted">
          Order {order.orderNumber} · {order.restaurant}
        </p>
        <div className="mt-6 rounded-xl border border-line p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CreditCard className="size-4" aria-hidden /> Test card •••• 4242
          </p>
          <p className="mt-1 text-xs text-muted">Choose an outcome to simulate the provider’s response.</p>
        </div>
        {!payable && (
          <div className="mt-4">
            <Notice tone="warn">This payment attempt is {payment.status.toLowerCase()}. Go back to the order to retry.</Notice>
          </div>
        )}
        {error && (
          <div className="mt-4">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        <div className="mt-6 grid gap-2">
          <Button size="lg" variant="success" disabled={!payable || !!busy} loading={busy === 'success'} onClick={() => simulate('success')}>
            Pay {inr(payment.amount)}
          </Button>
          <Button variant="secondary" disabled={!payable || !!busy} loading={busy === 'failure'} onClick={() => simulate('failure')}>
            Simulate a declined card
          </Button>
          <Button variant="ghost" onClick={() => nav(`/orders/${payment.orderId}`)}>
            Cancel and go back
          </Button>
        </div>
      </section>
    </div>
  );
}
