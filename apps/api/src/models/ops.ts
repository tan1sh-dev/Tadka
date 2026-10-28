import { Schema, model } from 'mongoose';
import { ASSIGNMENT_STATUSES, NOTIFICATION_EVENTS } from '@tadka/shared';
import { pointSchema } from './common';

const assignmentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    partnerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: [...ASSIGNMENT_STATUSES, 'SEARCHING'], default: 'SEARCHING' },
    offeredAt: { type: Date, default: null },
    offerExpiresAt: { type: Date, default: null },
    declinedPartnerIds: { type: [Schema.Types.ObjectId], default: [] },
    acceptedAt: Date,
    pickedUpAt: Date,
    deliveredAt: Date,
    lastLocation: {
      type: { lat: Number, lng: Number, accuracy: Number, at: Date, source: String, _id: false },
      default: null,
    },
    distanceKm: { type: Number, default: 0 },
    earnings: { base: Number, distancePay: Number, total: Number },
    history: { type: [{ status: String, partnerId: Schema.Types.ObjectId, at: Date, note: String, _id: false }], default: [] },
  },
  { timestamps: true },
);
assignmentSchema.index({ partnerId: 1, status: 1 });
assignmentSchema.index({ status: 1, offerExpiresAt: 1 });
export const AssignmentModel = model('DeliveryAssignment', assignmentSchema);

/** Breadcrumbs for an active delivery. Expire after 24h — we do not keep location trails indefinitely. */
const locationUpdateSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, required: true, index: true },
  partnerId: { type: Schema.Types.ObjectId, required: true },
  location: { type: pointSchema, required: true },
  accuracy: Number,
  source: { type: String, enum: ['gps', 'demo'], required: true },
  recordedAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
});
export const LocationUpdateModel = model('LocationUpdate', locationUpdateSchema);

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    event: { type: String, enum: NOTIFICATION_EVENTS, required: true },
    channel: { type: String, enum: ['sms'], default: 'sms' },
    to: { type: String, required: true },
    body: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'UNDELIVERED', 'SKIPPED'],
      default: 'PENDING',
    },
    provider: { type: String, default: null },
    providerMessageId: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: () => new Date() },
    lastError: { type: String, default: '' },
    dedupeKey: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);
notificationSchema.index({ status: 1, nextAttemptAt: 1 });
notificationSchema.index({ providerMessageId: 1 }, { sparse: true });
export const NotificationModel = model('Notification', notificationSchema);

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, required: true },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    changes: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });
export const AuditLogModel = model('AuditLog', auditLogSchema);

const reviewSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    customerName: { type: String, required: true },
    foodRating: { type: Number, required: true },
    deliveryRating: { type: Number, default: null },
    comment: { type: String, default: '' },
    hidden: { type: Boolean, default: false },
    hiddenReason: { type: String, default: '' },
  },
  { timestamps: true },
);
export const ReviewModel = model('Review', reviewSchema);

const payoutSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    orders: Number,
    itemTotal: Number,
    packaging: Number,
    commission: Number,
    gstOnCommission: Number,
    refundsAbsorbed: Number,
    net: Number,
    status: { type: String, enum: ['GENERATED', 'PAID'], default: 'GENERATED' },
  },
  { timestamps: true },
);
payoutSchema.index({ restaurantId: 1, periodStart: 1, periodEnd: 1 }, { unique: true });
export const PayoutModel = model('Payout', payoutSchema);
