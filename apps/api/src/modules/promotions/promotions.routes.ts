import { Router } from 'express';
import { CouponModel } from '../../models/order';

export const promotionsRouter = Router();

/** Public list of currently valid, platform-wide coupons (shown in the cart's "Offers" sheet). */
promotionsRouter.get('/', async (_req, res) => {
  const now = new Date();
  const list = await CouponModel.find({ active: true, validFrom: { $lte: now }, validTo: { $gte: now } })
    .sort({ minOrder: 1 })
    .limit(20)
    .lean();
  res.json({
    coupons: list
      .filter((c) => c.usageLimit == null || c.usedCount < c.usageLimit)
      .map((c) => ({
        code: c.code,
        description: c.description,
        type: c.type,
        value: c.value,
        maxDiscount: c.maxDiscount,
        minOrder: c.minOrder,
        validTo: c.validTo,
        firstOrderOnly: c.firstOrderOnly,
        restaurantIds: c.restaurantIds,
      })),
  });
});
