import { Link, useSearchParams } from 'react-router';
import { Bike, CircleHelp, Mail, Store } from 'lucide-react';

export function SupportPage() {
  const [params] = useSearchParams();
  const order = params.get('order');
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-extrabold sm:text-3xl">Help & support</h1>
      {order && <p className="rounded-xl bg-turmeric-100 px-3 py-2 text-sm">About order <strong>{order}</strong></p>}
      <section className="card divide-y divide-line">
        {[
          ['Where is my order?', 'Open the order from “Orders”. The time range and live map update automatically; the reason for the latest change is shown under the estimate.'],
          ['Something was missing or wrong', 'Open the delivered order and choose “Report an issue”. A support agent reviews every request; approved refunds go back to your original payment method.'],
          ['Can I cancel?', 'Yes, free of charge until the restaurant accepts. Paid orders are refunded in full automatically.'],
          ['Why was I charged these fees?', 'Every fee is listed on the bill with a reason before you pay. We never add charges after checkout.'],
          ['Dietary questions', 'Turn on Dietary Guard in your account. Ingredient data is declared by restaurants; for severe allergies, please also confirm with the restaurant.'],
        ].map(([q, a]) => (
          <details key={q} className="group p-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
              <CircleHelp className="size-4 text-brand-600" aria-hidden /> {q}
            </summary>
            <p className="mt-2 text-sm text-muted">{a}</p>
          </details>
        ))}
      </section>
      <section className="card flex items-center gap-3 p-5 text-sm">
        <Mail className="size-5 text-muted" aria-hidden />
        <p>
          Still stuck? Email <a className="font-semibold text-brand-700 underline" href={`mailto:support@tadka.example?subject=${encodeURIComponent(order ? `Order ${order}` : 'Support')}`}>support@tadka.example</a> (demo address). In-app chat is on our roadmap.
        </p>
      </section>
    </div>
  );
}

export function PartnerJoinPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-extrabold sm:text-3xl">Partner with Tadka</h1>
      <p className="text-muted">Transparent commissions for restaurants. Clear per-delivery earnings for riders. No 10-minute promises.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/partner/join/restaurant" className="card p-6 hover:shadow-[var(--shadow-pop)]">
          <Store className="size-8 text-brand-600" aria-hidden />
          <h2 className="mt-3 text-xl font-bold">List your restaurant</h2>
          <p className="mt-1 text-sm text-muted">See commission and GST on every order in your dashboard. Verification needs your FSSAI licence.</p>
        </Link>
        <Link to="/partner/join/delivery" className="card p-6 hover:shadow-[var(--shadow-pop)]">
          <Bike className="size-8 text-leaf-600" aria-hidden />
          <h2 className="mt-3 text-xl font-bold">Become a delivery partner</h2>
          <p className="mt-1 text-sm text-muted">See the payout before you accept each delivery. Location is shared only while you are on a delivery.</p>
        </Link>
      </div>
    </div>
  );
}
