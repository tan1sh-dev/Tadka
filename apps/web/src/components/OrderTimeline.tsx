import clsx from 'clsx';
import { Check } from 'lucide-react';
import { STATUS_LABELS, type OrderStatus } from '@tadka/shared';
import type { TimelineEntry } from '../lib/types';
import { formatTime } from '../lib/format';

const HAPPY_PATH: OrderStatus[] = ['CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'];

export function OrderTimeline({ status, timeline }: { status: OrderStatus; timeline: TimelineEntry[] }) {
  const terminalBad = ['CANCELLED', 'REJECTED'].includes(status);
  if (terminalBad || status === 'PAYMENT_PENDING' || status === 'PAYMENT_FAILED') {
    return (
      <ol className="space-y-3">
        {timeline.map((t, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className={clsx('mt-1.5 size-2.5 shrink-0 rounded-full', i === timeline.length - 1 ? (terminalBad ? 'bg-chili-600' : 'bg-turmeric-400') : 'bg-line-strong')} />
            <span>
              <span className="font-semibold">{STATUS_LABELS[t.status]}</span> <span className="text-muted">· {formatTime(t.at)}</span>
              {t.note && <span className="block text-xs text-muted">{t.note}</span>}
            </span>
          </li>
        ))}
      </ol>
    );
  }
  const reached = new Map(timeline.map((t) => [t.status, t]));
  const currentIdx = HAPPY_PATH.indexOf(status);
  return (
    <ol className="relative" aria-label="Order progress">
      {HAPPY_PATH.map((s, i) => {
        const done = i <= currentIdx;
        const current = i === currentIdx;
        const t = reached.get(s);
        return (
          <li key={s} className="relative flex gap-3 pb-5 last:pb-0" aria-current={current ? 'step' : undefined}>
            {i < HAPPY_PATH.length - 1 && <span className={clsx('absolute left-[11px] top-6 h-[calc(100%-16px)] w-0.5', i < currentIdx ? 'bg-leaf-600' : 'bg-line')} aria-hidden />}
            <span
              className={clsx(
                'relative z-10 grid size-6 shrink-0 place-items-center rounded-full border-2 text-white',
                done ? 'border-leaf-600 bg-leaf-600' : 'border-line-strong bg-surface',
              )}
            >
              {done && !current && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
              {current && <span className="size-2 rounded-full bg-white" />}
              {current && s !== 'DELIVERED' && <span className="absolute inset-0 rounded-full bg-leaf-600 animate-[pulse-ring_1.6s_ease-out_infinite]" aria-hidden />}
            </span>
            <div className="-mt-0.5">
              <p className={clsx('text-sm', done ? 'font-semibold text-ink' : 'text-muted')}>{STATUS_LABELS[s]}</p>
              {t && <p className="text-xs text-muted">{formatTime(t.at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
