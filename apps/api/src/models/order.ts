import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  ITEM_DIETS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  REFUND_RECORD_STATUSES,
  REFUND_STATUSES,
} from '@tadka/shared';
import { addressFields, pointSchema } from './common';

const orderItemSchema = new Schema(
  {
    menuItemId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    diet: { type: String, enum: ITEM_DIETS, required: true },
    quantity: { type: Number, required: true },
    basePrice: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
    options: { type: [{ groupName: String, name: String, price: Number, _id: false }], default: [] },
  },
  { _id: false },
);

const etaSchema = new Schema(
  {
    minMinutes: Number,
    maxMinutes: Number,
    confidence: String,
    basis: String,
    reason: String,
    computedAt: Date,
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    /** Immutable snapshots: history must not change when menus or addresses do. */
    restaurantSnapshot: {
      name: String,
      phone: String,
      locality: String,
      location: { type: pointSchema },
    },
    deliveryAddress: { label: String, ...addressFields },
    contactName: { type: String, required: true },
    contactPhone: { type: String, required: true },
    items: { type: [orderItemSchema], required: true },
    pricing: {
      itemTotal: Number,
      packagingFee: Number,
      deliveryFee: Number,
      deliveryFeeWaived: Number,
      platformFee: Number,
      smallCartFee: Number,
      foodGst: Number,
      feeGst: Number,
      discount: Number,
      total: Number,
      breakdown: { type: [{ key: String, label: String, amount: Number, note: String, _id: false }], default: [] },
    },
    coupon: { type: { couponId: Schema.Types.ObjectId, code: String, discount: Number, _id: false }, default: null },
    commission: { bps: Number, amount: Number, gst: Number },
    distanceKm: { type: Number, required: true },
    /** Kitchen prep estimate captured at order time (learnt average or merchant default). */
    prepMinutes: { type: Number, default: 20 },
    /** Restaurant→customer two-wheeler minutes from the Routes API, when configured. */
    routedMinutes: { type: Number, default: null },
    instructions: { type: String, default: '' },
    status: { type: String, enum: ORDER_STATUSES, required: true },
    timeline: {
      type: [{ status: String, at: Date, actor: String, note: String, _id: false }],
      default: [],
    },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    refundStatus: { type: String, enum: REFUND_STATUSES, default: 'NONE' },
    refundedAmount: { type: Number, default: 0 },
    eta: { type: etaSchema, default: null },
    /** The first estimate shown after payment — used to measure ETA accuracy. */
    promisedEta: { type: etaSchema, default: null },
    confirmedAt: Date,
    acceptedAt: Date,
    readyAt: Date,
    pickedUpAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,
    cancelReason: { type: String, default: '' },
    deliveryOtp: { type: String, required: true, select: false },
    partnerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewed: { type: Boolean, default: false },
    supportStatus: { type: String, enum: ['NONE', 'OPEN', 'RESOLVED'], default: 'NONE' },
    idempotencyKey: { type: String, required: true },
    demo: { type: Boolean, default: false },
  },
  { timestamps: true },
);
orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ partnerId: 1, status: 1 });
orderSchema.index({ status: 1, updatedAt: 1 });
orderSchema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true });

export type Order = InferSchemaType<typeof orderSchema>;
export type OrderDoc = HydratedDocument<Order>;
export const OrderModel = model('Order', orderSchema);

const paymentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['mock', 'stripe'], required: true },
    attempt: { type: Number, default: 1 },
    providerRef: { type: String, default: null },
    providerPaymentId: { type: String, default: null },
    checkoutUrl: { type: String, default: null },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'CREATED' },
    failureReason: { type: String, default: '' },
    refundedAmount: { type: Number, default: 0 },
    events: { type: [{ type: { type: String }, at: Date, eventId: String, _id: false }], default: [] },
  },
  { timestamps: true },
);
paymentSchema.index({ provider: 1, providerRef: 1 }, { unique: true, partialFilterExpression: { providerRef: { $type: 'string' } } });
paymentSchema.index({ orderId: 1, attempt: 1 }, { unique: true });
export const PaymentModel = model('Payment', paymentSchema);

const refundSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    amount: { type: Number, required: true },
    kind: { type: String, enum: ['auto', 'requested'], required: true },
    reason: { type: String, required: true },
    details: { type: String, default: '' },
    status: { type: String, enum: REFUND_RECORD_STATUSES, required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decisionNote: { type: String, default: '' },
    providerRefundId: { type: String, default: null },
    failureReason: { type: String, default: '' },
  },
  { timestamps: true },
);
refundSchema.index({ status: 1, createdAt: -1 });
refundSchema.index({ providerRefundId: 1 }, { sparse: true });
export const RefundModel = model('Refund', refundSchema);

const webhookEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    outcome: { type: String, default: 'processed' },
  },
  { timestamps: true },
);
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
export const WebhookEventModel = model('WebhookEvent', webhookEventSchema);

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    description: { type: String, default: '' },
    type: { type: String, enum: ['percent', 'flat', 'free_delivery'], required: true },
    value: { type: Number, required: true },
    maxDiscount: { type: Number, default: null },
    minOrder: { type: Number, default: 0 },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    active: { type: Boolean, default: true },
    restaurantIds: { type: [String], default: [] },
    usageLimit: { type: Number, default: null },
    perUserLimit: { type: Number, default: 1 },
    firstOrderOnly: { type: Boolean, default: false },
    usedCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export const CouponModel = model('Coupon', couponSchema);

const couponRedemptionSchema = new Schema(
  {
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
  },
  { timestamps: true },
);
couponRedemptionSchema.index({ couponId: 1, userId: 1 });
export const CouponRedemptionModel = model('CouponRedemption', couponRedemptionSchema);
