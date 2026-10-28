import type { OrderStatus } from './enums';

export type Actor = 'customer' | 'restaurant' | 'delivery' | 'admin' | 'system';

type TransitionTable = Partial<Record<OrderStatus, Partial<Record<OrderStatus, Actor[]>>>>;

/**
 * The single source of truth for which order status changes are legal and who may make them.
 * Payment outcomes are always `system` — the browser can never confirm a payment.
 */
export const ORDER_TRANSITIONS: TransitionTable = {
  PAYMENT_PENDING: {
    CONFIRMED: ['system'],
    PAYMENT_FAILED: ['system'],
    CANCELLED: ['customer', 'admin', 'system'],
  },
  PAYMENT_FAILED: {
    PAYMENT_PENDING: ['customer'],
    CONFIRMED: ['system'], // a late success event after a failed attempt is still honoured
    CANCELLED: ['customer', 'admin', 'system'],
  },
  CONFIRMED: {
    ACCEPTED: ['restaurant'],
    REJECTED: ['restaurant', 'system'],
    CANCELLED: ['customer', 'admin'],
  },
  ACCEPTED: { PREPARING: ['restaurant'], CANCELLED: ['admin'] },
  PREPARING: { READY_FOR_PICKUP: ['restaurant'], CANCELLED: ['admin'] },
  READY_FOR_PICKUP: { PICKED_UP: ['delivery'], CANCELLED: ['admin'] },
  PICKED_UP: { OUT_FOR_DELIVERY: ['delivery'] },
  OUT_FOR_DELIVERY: { DELIVERED: ['delivery'] },
};

export const TERMINAL_STATUSES: OrderStatus[] = ['DELIVERED', 'REJECTED', 'CANCELLED'];

export class InvalidTransitionError extends Error {
  constructor(
    public from: OrderStatus,
    public to: OrderStatus,
    public actor: Actor,
  ) {
    super(`Order cannot move from ${from} to ${to} by ${actor}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return ORDER_TRANSITIONS[from]?.[to]?.includes(actor) ?? false;
}

export function assertTransition(from: OrderStatus, to: OrderStatus, actor: Actor): void {
  if (!canTransition(from, to, actor)) throw new InvalidTransitionError(from, to, actor);
}

export function nextStatusesFor(from: OrderStatus, actor: Actor): OrderStatus[] {
  const options = ORDER_TRANSITIONS[from] ?? {};
  return (Object.keys(options) as OrderStatus[]).filter((to) => options[to]?.includes(actor));
}

/** Statuses after which money has been captured and a cancellation implies a refund. */
export const PAID_STATUSES: OrderStatus[] = [
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PAYMENT_PENDING: 'Awaiting payment',
  PAYMENT_FAILED: 'Payment failed',
  CONFIRMED: 'Order placed',
  ACCEPTED: 'Restaurant accepted',
  PREPARING: 'Being prepared',
  READY_FOR_PICKUP: 'Ready for pickup',
  PICKED_UP: 'Picked up',
  OUT_FOR_DELIVERY: 'On the way',
  DELIVERED: 'Delivered',
  REJECTED: 'Rejected by restaurant',
  CANCELLED: 'Cancelled',
};
