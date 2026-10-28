import { applyBps, formatINR, type Paise } from './money';

export interface DeliverySlab {
  uptoKm: number;
  fee: Paise;
}

/** Platform-wide, admin-editable fee configuration. Rates are basis points. */
export interface PricingConfig {
  platformFee: Paise;
  deliverySlabs: DeliverySlab[];
  freeDeliveryAbove: Paise | null;
  smallCartThreshold: Paise;
  smallCartFee: Paise;
  foodGstBps: number;
  feeGstBps: number;
  maxDeliveryKm: number;
  defaultCommissionBps: number;
}

export const DEFAULT_PRICING: PricingConfig = {
  platformFee: 1000,
  deliverySlabs: [
    { uptoKm: 2, fee: 2000 },
    { uptoKm: 4, fee: 3000 },
    { uptoKm: 6, fee: 4500 },
    { uptoKm: 9, fee: 6000 },
  ],
  freeDeliveryAbove: 49900,
  smallCartThreshold: 14900,
  smallCartFee: 1500,
  foodGstBps: 500,
  feeGstBps: 1800,
  maxDeliveryKm: 9,
  defaultCommissionBps: 1800,
};

export type CouponType = 'percent' | 'flat' | 'free_delivery';

export interface CouponRule {
  code: string;
  type: CouponType;
  /** percent → bps; flat → paise; free_delivery → unused */
  value: number;
  maxDiscount: Paise | null;
  minOrder: Paise;
  validFrom: Date | string;
  validTo: Date | string;
  active: boolean;
  restaurantIds: string[];
  usageLimit: number | null;
  perUserLimit: number | null;
  firstOrderOnly: boolean;
  description?: string;
}

export interface CouponContext {
  itemTotal: Paise;
  restaurantId: string;
  now: Date;
  userPaidOrderCount: number;
  userCouponUses: number;
  totalCouponUses: number;
}

export type CouponResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'INACTIVE'
        | 'NOT_STARTED'
        | 'EXPIRED'
        | 'MIN_ORDER'
        | 'RESTAURANT'
        | 'USAGE_LIMIT'
        | 'PER_USER_LIMIT'
        | 'FIRST_ORDER';
      message: string;
    };

export function validateCoupon(c: CouponRule, ctx: CouponContext): CouponResult {
  const from = new Date(c.validFrom).getTime();
  const to = new Date(c.validTo).getTime();
  const now = ctx.now.getTime();
  if (!c.active) return { ok: false, code: 'INACTIVE', message: 'This coupon is no longer active.' };
  if (now < from) return { ok: false, code: 'NOT_STARTED', message: 'This coupon is not valid yet.' };
  if (now > to) return { ok: false, code: 'EXPIRED', message: 'This coupon has expired.' };
  if (c.restaurantIds.length > 0 && !c.restaurantIds.includes(ctx.restaurantId))
    return { ok: false, code: 'RESTAURANT', message: 'This coupon is not valid at this restaurant.' };
  if (ctx.itemTotal < c.minOrder)
    return {
      ok: false,
      code: 'MIN_ORDER',
      message: `Add ${formatINR(c.minOrder - ctx.itemTotal)} more to use this coupon (min ${formatINR(c.minOrder)}).`,
    };
  if (c.usageLimit !== null && ctx.totalCouponUses >= c.usageLimit)
    return { ok: false, code: 'USAGE_LIMIT', message: 'This coupon has been fully redeemed.' };
  if (c.perUserLimit !== null && ctx.userCouponUses >= c.perUserLimit)
    return { ok: false, code: 'PER_USER_LIMIT', message: 'You have already used this coupon.' };
  if (c.firstOrderOnly && ctx.userPaidOrderCount > 0)
    return { ok: false, code: 'FIRST_ORDER', message: 'This coupon is only for your first order.' };
  return { ok: true };
}

export function deliveryFeeFor(distanceKm: number, cfg: PricingConfig): Paise | null {
  if (distanceKm > cfg.maxDeliveryKm) return null;
  const slab = [...cfg.deliverySlabs].sort((a, b) => a.uptoKm - b.uptoKm).find((s) => distanceKm <= s.uptoKm);
  return slab ? slab.fee : null;
}

export interface QuoteInput {
  lines: { unitPrice: Paise; quantity: number }[];
  packagingFee: Paise;
  distanceKm: number;
  config: PricingConfig;
  /** A coupon that has already passed validateCoupon(). */
  coupon?: CouponRule | null;
}

export interface QuoteLine {
  key: 'items' | 'packaging' | 'delivery' | 'platform' | 'small_cart' | 'food_gst' | 'fee_gst' | 'discount';
  label: string;
  amount: Paise;
  note?: string;
}

export interface Quote {
  itemTotal: Paise;
  packagingFee: Paise;
  deliveryFee: Paise;
  deliveryFeeWaived: Paise;
  platformFee: Paise;
  smallCartFee: Paise;
  foodGst: Paise;
  feeGst: Paise;
  discount: Paise;
  total: Paise;
  breakdown: QuoteLine[];
  serviceable: boolean;
}

/**
 * Honest Price engine. Used by the browser for previews and by the server as the authority.
 * Every fee that contributes to `total` appears in `breakdown` with a plain-language note.
 */
export function computeQuote(input: QuoteInput): Quote {
  const { config: cfg } = input;
  const itemTotal = input.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const packagingFee = itemTotal > 0 ? input.packagingFee : 0;
  const slabFee = deliveryFeeFor(input.distanceKm, cfg);
  const serviceable = slabFee !== null;
  let deliveryFee = slabFee ?? 0;
  let deliveryFeeWaived = 0;
  if (cfg.freeDeliveryAbove !== null && itemTotal >= cfg.freeDeliveryAbove) {
    deliveryFeeWaived = deliveryFee;
    deliveryFee = 0;
  }
  const platformFee = itemTotal > 0 ? cfg.platformFee : 0;
  const smallCartFee = itemTotal > 0 && itemTotal < cfg.smallCartThreshold ? cfg.smallCartFee : 0;

  let foodDiscount = 0;
  let deliveryDiscount = 0;
  const c = input.coupon;
  if (c && itemTotal > 0) {
    if (c.type === 'percent') foodDiscount = applyBps(itemTotal, c.value);
    else if (c.type === 'flat') foodDiscount = c.value;
    else if (c.type === 'free_delivery') deliveryDiscount = deliveryFee;
    if (c.maxDiscount !== null) foodDiscount = Math.min(foodDiscount, c.maxDiscount);
    foodDiscount = Math.min(foodDiscount, itemTotal);
  }
  const discount = foodDiscount + deliveryDiscount;

  const foodGst = applyBps(itemTotal - foodDiscount + packagingFee, cfg.foodGstBps);
  const feeGst = applyBps(deliveryFee - deliveryDiscount + platformFee + smallCartFee, cfg.feeGstBps);
  const total = itemTotal + packagingFee + deliveryFee + platformFee + smallCartFee + foodGst + feeGst - discount;

  const breakdown: QuoteLine[] = [{ key: 'items', label: 'Item total', amount: itemTotal }];
  if (packagingFee) breakdown.push({ key: 'packaging', label: 'Packaging', amount: packagingFee, note: 'Set by the restaurant' });
  breakdown.push({
    key: 'delivery',
    label: 'Delivery fee',
    amount: deliveryFee,
    note: deliveryFeeWaived
      ? `Free above ${formatINR(cfg.freeDeliveryAbove ?? 0)} (saved ${formatINR(deliveryFeeWaived)})`
      : `${input.distanceKm.toFixed(1)} km distance slab`,
  });
  if (platformFee)
    breakdown.push({ key: 'platform', label: 'Platform fee', amount: platformFee, note: 'Flat per order, same everywhere' });
  if (smallCartFee)
    breakdown.push({
      key: 'small_cart',
      label: 'Small-order fee',
      amount: smallCartFee,
      note: `Add ${formatINR(cfg.smallCartThreshold - itemTotal)} more to remove`,
    });
  if (discount) breakdown.push({ key: 'discount', label: `Coupon ${c?.code ?? ''}`.trim(), amount: -discount });
  breakdown.push({ key: 'food_gst', label: 'GST on food', amount: foodGst, note: `${cfg.foodGstBps / 100}%` });
  if (feeGst) breakdown.push({ key: 'fee_gst', label: 'GST on fees', amount: feeGst, note: `${cfg.feeGstBps / 100}%` });

  return {
    itemTotal,
    packagingFee,
    deliveryFee,
    deliveryFeeWaived,
    platformFee,
    smallCartFee,
    foodGst,
    feeGst,
    discount,
    total,
    breakdown,
    serviceable,
  };
}

/** "All-in" estimate shown on restaurant cards: what a typical order for two really costs. */
export function estimateAllIn(priceForTwo: Paise, packagingFee: Paise, distanceKm: number, cfg: PricingConfig): Paise {
  return computeQuote({ lines: [{ unitPrice: priceForTwo, quantity: 1 }], packagingFee, distanceKm, config: cfg }).total;
}

export function commissionFor(itemTotal: Paise, packagingFee: Paise, commissionBps: number, gstBps = 1800) {
  const commission = applyBps(itemTotal, commissionBps);
  const gstOnCommission = applyBps(commission, gstBps);
  return { commission, gstOnCommission, net: itemTotal + packagingFee - commission - gstOnCommission };
}
