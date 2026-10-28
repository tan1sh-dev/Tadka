import { Schema, model, type InferSchemaType } from 'mongoose';
import { ALLERGENS, APPROVAL_STATUSES, DEFAULT_PRICING, ITEM_DIETS } from '@tadka/shared';
import { addressFields, pointSchema } from './common';

const restaurantSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
    cuisines: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    phone: { type: String, required: true },
    fssaiLicense: { type: String, required: true },
    imageUrl: { type: String, default: '' },
    priceForTwo: { type: Number, required: true },
    packagingFee: { type: Number, default: 0 },
    prepTimeMinutes: { type: Number, default: 20 },
    /** Rolling average learnt from accepted→ready durations; falls back to prepTimeMinutes. */
    avgPrepMinutes: { type: Number, default: null },
    deliveryRadiusKm: { type: Number, default: 6 },
    pureVeg: { type: Boolean, default: false },
    address: { ...addressFields, location: { type: pointSchema, required: false } },
    location: { type: pointSchema, required: true },
    hours: { type: [{ day: Number, open: String, close: String, _id: false }], default: [] },
    isPaused: { type: Boolean, default: false },
    approval: { type: String, enum: APPROVAL_STATUSES, default: 'PENDING', index: true },
    sponsored: { type: Boolean, default: false },
    commissionBps: { type: Number, default: null },
    rating: { avg: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
    demo: { type: Boolean, default: false },
  },
  { timestamps: true },
);
restaurantSchema.index({ location: '2dsphere' });
restaurantSchema.index({ name: 'text', cuisines: 'text', tags: 'text' });
export type Restaurant = InferSchemaType<typeof restaurantSchema>;
export const RestaurantModel = model('Restaurant', restaurantSchema);

const menuCategorySchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export const MenuCategoryModel = model('MenuCategory', menuCategorySchema);

const optionSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, default: 0 },
    diet: { type: String, enum: ITEM_DIETS, required: false },
    allergens: { type: [String], enum: ALLERGENS, default: [] },
    available: { type: Boolean, default: true },
  },
  { _id: false },
);

const menuItemSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'MenuCategory', required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    price: { type: Number, required: true },
    diet: { type: String, enum: ITEM_DIETS, required: true },
    vegan: { type: Boolean, default: false },
    jainFriendly: { type: Boolean, default: false },
    allergens: { type: [String], enum: ALLERGENS, default: [] },
    spiceLevel: { type: Number, default: 0 },
    tags: { type: [String], default: [] },
    imageUrl: { type: String, default: '' },
    available: { type: Boolean, default: true },
    isBestseller: { type: Boolean, default: false },
    optionGroups: {
      type: [{ id: String, name: String, min: Number, max: Number, options: [optionSchema], _id: false }],
      default: [],
    },
  },
  { timestamps: true },
);
menuItemSchema.index({ restaurantId: 1, categoryId: 1 });
menuItemSchema.index({ name: 'text', description: 'text', tags: 'text' });
export type MenuItem = InferSchemaType<typeof menuItemSchema>;
export const MenuItemModel = model('MenuItem', menuItemSchema);

const zoneSchema = new Schema(
  {
    name: { type: String, required: true },
    city: { type: String, required: true },
    center: { type: pointSchema, required: true },
    radiusKm: { type: Number, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const ZoneModel = model('Zone', zoneSchema);

const platformConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    pricing: { type: Schema.Types.Mixed, default: () => DEFAULT_PRICING },
  },
  { timestamps: true },
);
export const PlatformConfigModel = model('PlatformConfig', platformConfigSchema);
