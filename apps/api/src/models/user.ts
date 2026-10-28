import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ALLERGENS, APPROVAL_STATUSES, PROFILE_DIETS, ROLES } from '@tadka/shared';
import { addressFields, pointSchema } from './common';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: 'customer' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    /** Incremented on logout-everywhere / suspension to revoke outstanding JWTs. */
    tokenVersion: { type: Number, default: 0 },
    smsOptIn: { type: Boolean, default: true },
    dietary: {
      enabled: { type: Boolean, default: false },
      diet: { type: String, enum: PROFILE_DIETS, default: 'any' },
      avoidAllergens: { type: [String], enum: ALLERGENS, default: [] },
    },
    demo: { type: Boolean, default: false },
  },
  { timestamps: true },
);
userSchema.index({ role: 1, createdAt: -1 });

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model('User', userSchema);

const addressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, default: 'Home' },
    ...addressFields,
  },
  { timestamps: true },
);
export type Address = InferSchemaType<typeof addressSchema>;
export const AddressModel = model('Address', addressSchema);

const partnerProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    vehicle: { type: String, enum: ['bicycle', 'scooter', 'motorcycle', 'ev_scooter'], default: 'scooter' },
    vehicleNumber: { type: String, default: '' },
    city: { type: String, default: 'Bengaluru' },
    approval: { type: String, enum: APPROVAL_STATUSES, default: 'PENDING' },
    online: { type: Boolean, default: false },
    location: { type: pointSchema, default: undefined },
    locationAt: { type: Date, default: null },
    currentOrderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    demo: { type: Boolean, default: false },
  },
  { timestamps: true },
);
partnerProfileSchema.index({ location: '2dsphere' });
partnerProfileSchema.index({ approval: 1, online: 1, currentOrderId: 1 });
export const PartnerProfileModel = model('PartnerProfile', partnerProfileSchema);
