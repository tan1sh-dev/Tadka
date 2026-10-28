import type { Types } from 'mongoose';
import {
  PAID_STATUSES,
  checkDietary,
  computeQuote,
  haversineKm,
  isOpenAt,
  mergeDietaryFacts,
  validateCoupon,
  type CartLineInput,
  type CouponRule,
  type DietaryProfile,
  type LatLng,
  type OpeningWindow,
  type Quote,
} from '@tadka/shared';
import { fromPoint } from '../../models/common';
import { CouponModel, CouponRedemptionModel, OrderModel } from '../../models/order';
import { MenuItemModel, RestaurantModel } from '../../models/restaurant';
import { getPricingConfig } from '../../services/config';
import { findZoneFor } from '../../services/geo';
import { notFound } from '../../lib/errors';

export type BlockerCode =
  | 'RESTAURANT_CLOSED'
  | 'RESTAURANT_PAUSED'
  | 'NOT_SERVICEABLE'
  | 'ITEM_UNAVAILABLE'
  | 'INVALID_SELECTION'
  | 'DIETARY_CONFLICT'
  | 'NO_LOCATION';

export interface Blocker {
  code: BlockerCode;
  message: string;
  lineIndex?: number;
}

export interface ResolvedLine {
  menuItemId: Types.ObjectId;
  name: string;
  diet: 'veg' | 'egg' | 'nonveg';
  quantity: number;
  basePrice: number;
  unitPrice: number;
  lineTotal: number;
  options: { groupName: string; name: string; price: number }[];
  dietaryReasons: string[];
}

const findApprovedRestaurant = (id: string) => RestaurantModel.findOne({ _id: id, approval: 'APPROVED' }).lean();
type LeanRestaurant = NonNullable<Awaited<ReturnType<typeof findApprovedRestaurant>>>;

export interface ServerQuote {
  restaurant: LeanRestaurant;
  lines: ResolvedLine[];
  quote: Quote;
  distanceKm: number;
  coupon: (CouponRule & { _id: Types.ObjectId }) | null;
  couponError: { code: string; message: string } | null;
  blockers: Blocker[];
}

export interface QuoteArgs {
  restaurantId: string;
  lines: CartLineInput[];
  location: LatLng | null;
  couponCode?: string;
  userId?: string;
  dietary?: DietaryProfile | null;
  now?: Date;
}

/**
 * Server-authoritative pricing. Prices come only from the database; the browser sends ids and quantities.
 * Returns blockers instead of throwing so the cart can explain every problem at once.
 */
export async function buildServerQuote(a: QuoteArgs): Promise<ServerQuote> {
  const now = a.now ?? new Date();
  const restaurant = await findApprovedRestaurant(a.restaurantId);
  if (!restaurant) throw notFound('Restaurant');
  const cfg = await getPricingConfig();
  const blockers: Blocker[] = [];

  if (restaurant.isPaused) blockers.push({ code: 'RESTAURANT_PAUSED', message: `${restaurant.name} is not taking orders right now.` });
  else if (!isOpenAt(restaurant.hours as OpeningWindow[], now)) blockers.push({ code: 'RESTAURANT_CLOSED', message: `${restaurant.name} is closed right now.` });

  const ids = [...new Set(a.lines.map((l) => l.menuItemId))];
  const items = await MenuItemModel.find({ _id: { $in: ids }, restaurantId: restaurant._id }).lean();
  const byId = new Map(items.map((i) => [String(i._id), i]));

  const lines: ResolvedLine[] = [];
  a.lines.forEach((line, lineIndex) => {
    const item = byId.get(line.menuItemId);
    if (!item) {
      blockers.push({ code: 'ITEM_UNAVAILABLE', message: 'An item in your cart is no longer on the menu.', lineIndex });
      return;
    }
    if (!item.available) blockers.push({ code: 'ITEM_UNAVAILABLE', message: `${item.name} is sold out right now.`, lineIndex });

    const chosen: { groupName: string; name: string; price: number; diet?: string; allergens?: string[] }[] = [];
    for (const group of item.optionGroups ?? []) {
      const sel = (line.selections ?? []).find((s) => s.groupId === group.id);
      const optionIds = [...new Set(sel?.optionIds ?? [])];
      if (optionIds.length < (group.min ?? 0) || optionIds.length > (group.max ?? 1)) {
        blockers.push({
          code: 'INVALID_SELECTION',
          message: `${item.name}: choose ${group.min === group.max ? group.min : `${group.min}–${group.max}`} in "${group.name}".`,
          lineIndex,
        });
        continue;
      }
      for (const oid of optionIds) {
        const opt = group.options.find((o) => o.id === oid);
        if (!opt || !opt.available) {
          blockers.push({ code: 'INVALID_SELECTION', message: `${item.name}: an option you chose is unavailable.`, lineIndex });
          continue;
        }
        chosen.push({ groupName: group.name ?? '', name: opt.name, price: opt.price, diet: opt.diet ?? undefined, allergens: opt.allergens });
      }
    }
    const unknownGroup = (line.selections ?? []).find((s) => !(item.optionGroups ?? []).some((g) => g.id === s.groupId));
    if (unknownGroup) blockers.push({ code: 'INVALID_SELECTION', message: `${item.name}: invalid customisation.`, lineIndex });

    const facts = mergeDietaryFacts(
      { diet: item.diet, vegan: item.vegan, jainFriendly: item.jainFriendly, allergens: item.allergens },
      chosen.map((c) => ({ diet: c.diet as 'veg' | 'egg' | 'nonveg' | undefined, allergens: c.allergens as never })),
    );
    const guard = checkDietary(a.dietary, facts);
    if (!guard.ok)
      blockers.push({
        code: 'DIETARY_CONFLICT',
        message: `${item.name} conflicts with your dietary profile: ${guard.reasons.join(', ')}.`,
        lineIndex,
      });

    const unitPrice = item.price + chosen.reduce((s, c) => s + c.price, 0);
    lines.push({
      menuItemId: item._id,
      name: item.name,
      diet: facts.diet,
      quantity: line.quantity,
      basePrice: item.price,
      unitPrice,
      lineTotal: unitPrice * line.quantity,
      options: chosen.map(({ groupName, name, price }) => ({ groupName, name, price })),
      dietaryReasons: guard.reasons,
    });
  });

  let distanceKm = 0;
  if (!a.location) {
    blockers.push({ code: 'NO_LOCATION', message: 'Choose a delivery address to see the exact delivery fee.' });
  } else {
    distanceKm = Math.round(haversineKm(fromPoint(restaurant.location)!, a.location) * 10) / 10;
    const zone = await findZoneFor(a.location);
    if (!zone || distanceKm > restaurant.deliveryRadiusKm || distanceKm > cfg.maxDeliveryKm)
      blockers.push({ code: 'NOT_SERVICEABLE', message: `${restaurant.name} doesn't deliver to this address (${distanceKm} km away).` });
  }

  const itemTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  let coupon: ServerQuote['coupon'] = null;
  let couponError: ServerQuote['couponError'] = null;
  if (a.couponCode) {
    const c = await CouponModel.findOne({ code: a.couponCode }).lean();
    if (!c) couponError = { code: 'NOT_FOUND', message: 'This coupon code does not exist.' };
    else {
      const [userPaidOrderCount, userCouponUses] = a.userId
        ? await Promise.all([
            OrderModel.countDocuments({ customerId: a.userId, status: { $in: PAID_STATUSES } }),
            CouponRedemptionModel.countDocuments({ couponId: c._id, userId: a.userId }),
          ])
        : [0, 0];
      const rule = c as unknown as CouponRule & { _id: Types.ObjectId };
      const r = validateCoupon(rule, {
        itemTotal,
        restaurantId: String(restaurant._id),
        now,
        userPaidOrderCount,
        userCouponUses,
        totalCouponUses: c.usedCount,
      });
      if (r.ok) coupon = rule;
      else couponError = { code: r.code, message: r.message };
    }
  }

  const quote = computeQuote({ lines, packagingFee: restaurant.packagingFee, distanceKm, config: cfg, coupon });
  return { restaurant, lines, quote, distanceKm, coupon, couponError, blockers };
}
