import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICING,
  assertTransition,
  canTransition,
  checkDietary,
  commissionFor,
  computeQuote,
  estimateEta,
  haversineKm,
  isOpenAt,
  mergeDietaryFacts,
  nextStatusesFor,
  parseCraving,
  registerSchema,
  validateCoupon,
  type CouponRule,
} from './index';

const coupon = (over: Partial<CouponRule> = {}): CouponRule => ({
  code: 'TADKA50',
  type: 'percent',
  value: 5000,
  maxDiscount: 10000,
  minOrder: 19900,
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
  active: true,
  restaurantIds: [],
  usageLimit: null,
  perUserLimit: 1,
  firstOrderOnly: false,
  ...over,
});

const ctx = {
  itemTotal: 30000,
  restaurantId: 'r1',
  now: new Date('2026-06-01'),
  userPaidOrderCount: 0,
  userCouponUses: 0,
  totalCouponUses: 0,
};

describe('computeQuote', () => {
  it('itemises every fee and the total equals the sum of the breakdown', () => {
    const q = computeQuote({
      lines: [
        { unitPrice: 25000, quantity: 1 },
        { unitPrice: 5000, quantity: 2 },
      ],
      packagingFee: 2000,
      distanceKm: 3,
      config: DEFAULT_PRICING,
    });
    expect(q.itemTotal).toBe(35000);
    expect(q.deliveryFee).toBe(3000);
    expect(q.platformFee).toBe(1000);
    expect(q.smallCartFee).toBe(0);
    expect(q.foodGst).toBe(Math.round((35000 + 2000) * 0.05));
    expect(q.feeGst).toBe(Math.round((3000 + 1000) * 0.18));
    expect(q.breakdown.reduce((s, l) => s + l.amount, 0)).toBe(q.total);
  });

  it('waives delivery above the free threshold and applies small-cart fee below threshold', () => {
    const big = computeQuote({ lines: [{ unitPrice: 60000, quantity: 1 }], packagingFee: 0, distanceKm: 1, config: DEFAULT_PRICING });
    expect(big.deliveryFee).toBe(0);
    expect(big.deliveryFeeWaived).toBe(2000);
    const small = computeQuote({ lines: [{ unitPrice: 9900, quantity: 1 }], packagingFee: 0, distanceKm: 1, config: DEFAULT_PRICING });
    expect(small.smallCartFee).toBe(DEFAULT_PRICING.smallCartFee);
  });

  it('flags unserviceable distance', () => {
    const q = computeQuote({ lines: [{ unitPrice: 30000, quantity: 1 }], packagingFee: 0, distanceKm: 12, config: DEFAULT_PRICING });
    expect(q.serviceable).toBe(false);
  });

  it('caps percent coupons at maxDiscount and lowers food GST accordingly', () => {
    const q = computeQuote({
      lines: [{ unitPrice: 40000, quantity: 1 }],
      packagingFee: 0,
      distanceKm: 1,
      config: DEFAULT_PRICING,
      coupon: coupon(),
    });
    expect(q.discount).toBe(10000);
    expect(q.foodGst).toBe(Math.round(30000 * 0.05));
  });

  it('free_delivery coupon only removes delivery fee', () => {
    const q = computeQuote({
      lines: [{ unitPrice: 30000, quantity: 1 }],
      packagingFee: 0,
      distanceKm: 3,
      config: DEFAULT_PRICING,
      coupon: coupon({ type: 'free_delivery', value: 0 }),
    });
    expect(q.discount).toBe(3000);
    expect(q.feeGst).toBe(Math.round(1000 * 0.18));
  });
});

describe('validateCoupon', () => {
  it('accepts a valid coupon', () => expect(validateCoupon(coupon(), ctx)).toEqual({ ok: true }));
  it('rejects expired', () => expect(validateCoupon(coupon(), { ...ctx, now: new Date('2027-01-02') })).toMatchObject({ code: 'EXPIRED' }));
  it('rejects below minimum with the shortfall', () => {
    const r = validateCoupon(coupon(), { ...ctx, itemTotal: 10000 });
    expect(r).toMatchObject({ ok: false, code: 'MIN_ORDER' });
  });
  it('enforces per-user, global, first-order and restaurant limits', () => {
    expect(validateCoupon(coupon(), { ...ctx, userCouponUses: 1 })).toMatchObject({ code: 'PER_USER_LIMIT' });
    expect(validateCoupon(coupon({ usageLimit: 5 }), { ...ctx, totalCouponUses: 5 })).toMatchObject({ code: 'USAGE_LIMIT' });
    expect(validateCoupon(coupon({ firstOrderOnly: true }), { ...ctx, userPaidOrderCount: 2 })).toMatchObject({ code: 'FIRST_ORDER' });
    expect(validateCoupon(coupon({ restaurantIds: ['r9'] }), ctx)).toMatchObject({ code: 'RESTAURANT' });
    expect(validateCoupon(coupon({ active: false }), ctx)).toMatchObject({ code: 'INACTIVE' });
  });
});

describe('order state machine', () => {
  it('only the system can confirm payment', () => {
    expect(canTransition('PAYMENT_PENDING', 'CONFIRMED', 'system')).toBe(true);
    expect(canTransition('PAYMENT_PENDING', 'CONFIRMED', 'customer')).toBe(false);
    expect(canTransition('PAYMENT_PENDING', 'CONFIRMED', 'admin')).toBe(false);
  });
  it('enforces actors for each step', () => {
    expect(() => assertTransition('CONFIRMED', 'ACCEPTED', 'restaurant')).not.toThrow();
    expect(() => assertTransition('CONFIRMED', 'ACCEPTED', 'delivery')).toThrow();
    expect(() => assertTransition('READY_FOR_PICKUP', 'PICKED_UP', 'restaurant')).toThrow();
    expect(() => assertTransition('DELIVERED', 'CANCELLED', 'admin')).toThrow();
  });
  it('customers can cancel only before the restaurant accepts', () => {
    expect(canTransition('CONFIRMED', 'CANCELLED', 'customer')).toBe(true);
    expect(canTransition('ACCEPTED', 'CANCELLED', 'customer')).toBe(false);
  });
  it('lists next statuses per actor', () => {
    expect(nextStatusesFor('CONFIRMED', 'restaurant').sort()).toEqual(['ACCEPTED', 'REJECTED']);
  });
});

describe('Dietary Guard', () => {
  const jain = { enabled: true, diet: 'jain' as const, avoidAllergens: [] };
  it('blocks egg for vegetarians and non-jain veg for jain profile', () => {
    expect(checkDietary({ ...jain, diet: 'veg' }, { diet: 'egg' }).ok).toBe(false);
    expect(checkDietary(jain, { diet: 'veg', jainFriendly: false }).reasons[0]).toMatch(/Jain/);
    expect(checkDietary(jain, { diet: 'veg', jainFriendly: true }).ok).toBe(true);
  });
  it('blocks allergens, including those introduced by add-ons', () => {
    const profile = { enabled: true, diet: 'any' as const, avoidAllergens: ['peanut' as const] };
    const merged = mergeDietaryFacts({ diet: 'veg', allergens: [] }, [{ allergens: ['peanut'] }]);
    expect(checkDietary(profile, merged)).toEqual({ ok: false, reasons: ['Contains peanut'] });
  });
  it('add-on with chicken makes a veg item non-veg', () => {
    expect(mergeDietaryFacts({ diet: 'veg' }, [{ diet: 'nonveg' }]).diet).toBe('nonveg');
  });
  it('is a no-op when disabled', () => {
    expect(checkDietary({ ...jain, enabled: false }, { diet: 'nonveg' }).ok).toBe(true);
  });
});

describe('ETA', () => {
  const base = { now: new Date('2026-06-01T12:00:00Z'), prepMinutes: 20, restaurantToCustomerKm: 3 };
  it('returns wider ranges early and narrower ranges with live location', () => {
    const early = estimateEta({ ...base, status: 'CONFIRMED' })!;
    const live = estimateEta({ ...base, status: 'OUT_FOR_DELIVERY', partnerToCustomerKm: 1 })!;
    expect(early.maxMinutes - early.minMinutes).toBeGreaterThan(live.maxMinutes - live.minMinutes);
    expect(live.confidence).toBe('high');
  });
  it('subtracts elapsed preparation time', () => {
    const a = estimateEta({ ...base, status: 'PREPARING', acceptedAt: base.now })!;
    const b = estimateEta({ ...base, status: 'PREPARING', acceptedAt: new Date(base.now.getTime() - 15 * 60000) })!;
    expect(b.maxMinutes).toBeLessThan(a.maxMinutes);
  });
  it('degrades confidence without location', () => {
    expect(estimateEta({ ...base, status: 'PICKED_UP', pickedUpAt: base.now })!.confidence).toBe('low');
  });
  it('returns null for terminal states', () => expect(estimateEta({ ...base, status: 'DELIVERED' })).toBeNull());
  it('haversine is roughly right (Koramangala → Indiranagar ≈ 4-5 km)', () => {
    const d = haversineKm({ lat: 12.9352, lng: 77.6245 }, { lat: 12.9784, lng: 77.6408 });
    expect(d).toBeGreaterThan(4);
    expect(d).toBeLessThan(5.5);
  });
});

describe('craving parser', () => {
  it('extracts budget, diet, tags and terms', () => {
    const p = parseCraving('something spicy veg biryani under ₹300');
    expect(p.maxPrice).toBe(30000);
    expect(p.diet).toBe('veg');
    expect(p.tags).toEqual(['spicy']);
    expect(p.terms).toEqual(['biryani']);
  });
  it('handles plain keywords', () => expect(parseCraving('dosa').terms).toEqual(['dosa']));
  it('detects quick intent', () => expect(parseCraving('quick light lunch').quick).toBe(true));
});

describe('misc', () => {
  it('normalises Indian phone numbers', () => {
    const r = registerSchema.parse({ name: 'Asha', email: 'A@x.in', phone: '098765 43210', password: 'longenough' });
    expect(r.phone).toBe('+919876543210');
    expect(r.email).toBe('a@x.in');
    expect(() => registerSchema.parse({ name: 'A', email: 'a@x.in', phone: '12345', password: 'x' })).toThrow();
  });
  it('opening hours honour IST and overnight windows', () => {
    // 2026-06-01 is a Monday. 23:30 IST = 18:00 UTC.
    const lateMon = new Date('2026-06-01T18:00:00Z');
    expect(isOpenAt([{ day: 1, open: '11:00', close: '23:00' }], lateMon)).toBe(false);
    expect(isOpenAt([{ day: 1, open: '18:00', close: '02:00' }], lateMon)).toBe(true);
    // 01:00 IST Tuesday = 19:30 UTC Monday
    expect(isOpenAt([{ day: 1, open: '18:00', close: '02:00' }], new Date('2026-06-01T19:30:00Z'))).toBe(true);
    expect(isOpenAt([], lateMon)).toBe(true);
  });
  it('commission maths', () => {
    expect(commissionFor(100000, 2000, 1800)).toEqual({ commission: 18000, gstOnCommission: 3240, net: 80760 });
  });
});
