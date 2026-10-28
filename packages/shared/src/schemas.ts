import { z } from 'zod';
import { ALLERGENS, ITEM_DIETS, PROFILE_DIETS } from './enums';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** Indian mobile: optional +91/0 prefix, 10 digits starting 6–9. Normalised to +91XXXXXXXXXX. */
export const indianPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^(\+91|91|0)?[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit Indian mobile number')
  .transform((v) => `+91${v.slice(-10)}`);

export const pincode = z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code');

const paise = z.number().int().min(0).max(10_000_000);
const httpsUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((u) => u.startsWith('https://'), 'Image URL must use https');

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(120),
  phone: indianPhone,
  password: z.string().min(8, 'At least 8 characters').max(128),
  role: z.enum(['customer', 'restaurant', 'delivery']).default('customer'),
  smsOptIn: z.boolean().default(true),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

export const dietaryProfileSchema = z.object({
  enabled: z.boolean(),
  diet: z.enum(PROFILE_DIETS),
  avoidAllergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: indianPhone.optional(),
  smsOptIn: z.boolean().optional(),
  dietary: dietaryProfileSchema.optional(),
});

export const addressSchema = z.object({
  label: z.string().trim().min(1).max(30).default('Home'),
  line1: z.string().trim().min(2, 'House / flat / floor is required').max(120),
  line2: z.string().trim().max(120).optional().default(''),
  locality: z.string().trim().min(2).max(80),
  landmark: z.string().trim().max(80).optional().default(''),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  pincode,
  location: latLngSchema,
});
export type AddressInput = z.input<typeof addressSchema>;

export const cartLineSchema = z.object({
  menuItemId: objectId,
  quantity: z.number().int().min(1).max(20),
  selections: z
    .array(z.object({ groupId: z.string().min(1).max(40), optionIds: z.array(z.string().min(1).max(40)).max(20) }))
    .max(10)
    .default([]),
});
export type CartLineInput = z.input<typeof cartLineSchema>;

export const quoteRequestSchema = z.object({
  restaurantId: objectId,
  lines: z.array(cartLineSchema).min(1).max(30),
  addressId: objectId.optional(),
  location: latLngSchema.optional(),
  couponCode: z.string().trim().toUpperCase().max(20).optional(),
});
export type QuoteRequest = z.input<typeof quoteRequestSchema>;

export const createOrderSchema = quoteRequestSchema.extend({
  addressId: objectId,
  expectedTotal: paise,
  instructions: z.string().trim().max(200).optional().default(''),
});
export type CreateOrderInput = z.input<typeof createOrderSchema>;

export const weeklyHoursSchema = z
  .array(
    z.object({
      day: z.number().int().min(0).max(6),
      open: z.string().regex(/^\d{2}:\d{2}$/),
      close: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  )
  .max(14);

export const restaurantProfileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).default(''),
  cuisines: z.array(z.string().trim().min(2).max(30)).min(1).max(6),
  tags: z.array(z.string().trim().max(20)).max(10).default([]),
  phone: indianPhone,
  fssaiLicense: z.string().trim().regex(/^\d{14}$/, 'FSSAI licence numbers have 14 digits'),
  imageUrl: httpsUrl.optional().or(z.literal('')),
  priceForTwo: paise,
  packagingFee: paise.max(10000).default(0),
  prepTimeMinutes: z.number().int().min(5).max(90).default(20),
  deliveryRadiusKm: z.number().min(1).max(15).default(6),
  pureVeg: z.boolean().default(false),
  address: addressSchema.omit({ label: true }),
  hours: weeklyHoursSchema.default([]),
});
export type RestaurantProfileInput = z.input<typeof restaurantProfileSchema>;

export const menuCategorySchema = z.object({
  name: z.string().trim().min(1).max(50),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

const optionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  price: paise.max(500000),
  diet: z.enum(ITEM_DIETS).optional(),
  allergens: z.array(z.enum(ALLERGENS)).default([]),
  available: z.boolean().default(true),
});

export const optionGroupSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(60),
    min: z.number().int().min(0).max(10),
    max: z.number().int().min(1).max(10),
    options: z.array(optionSchema).min(1).max(20),
  })
  .refine((g) => g.min <= g.max, 'min cannot exceed max');

export const menuItemSchema = z.object({
  categoryId: objectId,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(''),
  price: paise.min(100).max(500000),
  diet: z.enum(ITEM_DIETS),
  vegan: z.boolean().default(false),
  jainFriendly: z.boolean().default(false),
  allergens: z.array(z.enum(ALLERGENS)).default([]),
  spiceLevel: z.number().int().min(0).max(3).default(0),
  tags: z.array(z.string().trim().max(20)).max(10).default([]),
  imageUrl: httpsUrl.optional().or(z.literal('')),
  available: z.boolean().default(true),
  isBestseller: z.boolean().default(false),
  optionGroups: z.array(optionGroupSchema).max(6).default([]),
});
export type MenuItemInput = z.input<typeof menuItemSchema>;

export const couponSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4,20}$/),
  description: z.string().trim().max(140).default(''),
  type: z.enum(['percent', 'flat', 'free_delivery']),
  value: z.number().int().min(0).max(1_000_000),
  maxDiscount: paise.nullable().default(null),
  minOrder: paise.default(0),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date(),
  active: z.boolean().default(true),
  restaurantIds: z.array(objectId).default([]),
  usageLimit: z.number().int().min(1).nullable().default(null),
  perUserLimit: z.number().int().min(1).nullable().default(1),
  firstOrderOnly: z.boolean().default(false),
});

export const zoneSchema = z.object({
  name: z.string().trim().min(2).max(60),
  city: z.string().trim().min(2).max(60),
  center: latLngSchema,
  radiusKm: z.number().min(0.5).max(30),
  active: z.boolean().default(true),
});

export const pricingConfigSchema = z.object({
  platformFee: paise.max(10000),
  deliverySlabs: z.array(z.object({ uptoKm: z.number().min(0.5).max(30), fee: paise.max(20000) })).min(1).max(10),
  freeDeliveryAbove: paise.nullable(),
  smallCartThreshold: paise,
  smallCartFee: paise.max(10000),
  foodGstBps: z.number().int().min(0).max(2800),
  feeGstBps: z.number().int().min(0).max(2800),
  maxDeliveryKm: z.number().min(1).max(30),
  defaultCommissionBps: z.number().int().min(0).max(5000),
});

export const reviewSchema = z.object({
  foodRating: z.number().int().min(1).max(5),
  deliveryRating: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(500).default(''),
});

export const refundRequestSchema = z.object({
  reason: z.enum(['missing_items', 'wrong_items', 'quality', 'late', 'not_delivered', 'other']),
  details: z.string().trim().min(5).max(500),
  amount: paise.optional(),
});

export const locationUpdateSchema = z.object({
  orderId: objectId,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10000).optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  recordedAt: z.number().int(),
  source: z.enum(['gps', 'demo']).default('gps'),
});
export type LocationUpdateInput = z.input<typeof locationUpdateSchema>;
