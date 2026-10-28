import clsx from 'clsx';
import { Info } from 'lucide-react';
import type { Quote } from '@tadka/shared';
import { inr } from '../lib/format';

/** Honest Price: every rupee in the total is a visible, explained line. */
export function PriceBreakdown({ quote, compact }: { quote: Quote; compact?: boolean }) {
  return (
    <div>
      <dl className="space-y-2 text-sm">
        {quote.breakdown.map((l) => (
          <div key={l.key} className="flex items-start justify-between gap-4">
            <dt className="text-ink-2">
              {l.label}
              {l.note && !compact && <span className="block text-xs text-muted">{l.note}</span>}
            </dt>
            <dd className={clsx('num shrink-0 font-medium', l.amount < 0 && 'text-leaf-700')}>
              {l.amount < 0 ? `− ${inr(-l.amount)}` : inr(l.amount)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-line-strong pt-3">
        <span className="font-bold">To pay</span>
        <span className="num font-display text-xl font-extrabold">{inr(quote.total)}</span>
      </div>
      {!compact && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          This is the final amount. Nothing is added after this screen; if a price changes before you pay, we’ll show you the difference first.
        </p>
      )}
    </div>
  );
}
