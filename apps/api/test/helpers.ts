import crypto from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { connectDb } from '../src/lib/db';
import { hashPassword } from '../src/modules/auth/auth.routes';
import { toPoint } from '../src/models/common';
import { CouponModel } from '../src/models/order';
import { MenuCategoryModel, MenuItemModel, RestaurantModel, ZoneModel } from '../src/models/restaurant';
import { PartnerProfileModel, UserModel } from '../src/models/user';
import { clearConfigCache } from '../src/services/config';
import mongoose from 'mongoose';

let app: Express | null = null;

export async function setupApp() {
  if (mongoose.connection.readyState !== 1) await connectDb();
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.syncIndexes()));
  clearConfigCache();
  app ??= createApp();
  return app;
}

/** Supertest agent with a cookie jar and the CSRF double-submit header applied automatically. */
export class Client {
  agent: ReturnType<typeof request.agent>;
  csrf = '';
  constructor(app: Express) {
    this.agent = request.agent(app);
  }
  async init() {
    const r = await this.agent.get('/api/v1/auth/csrf');
    this.csrf = r.body.csrfToken;
    return this;
  }
  get(path: string) {
    return this.agent.get(`/api/v1${path}`);
  }
  post(path: string, body: object = {}, headers: Record<string, string> = {}) {
    return this.agent.post(`/api/v1${path}`).set('x-csrf-token', this.csrf).set(headers).send(body);
  }
  put(path: string, body: object = {}) {
    return this.agent.put(`/api/v1${path}`).set('x-csrf-token', this.csrf).send(body);
  }
  patch(path: string, body: object = {}) {
    return this.agent.patch(`/api/v1${path}`).set('x-csrf-token', this.csrf).send(body);
  }
  del(path: string) {
    return this.agent.delete(`/api/v1${path}`).set('x-csrf-token', this.csrf);
  }
}

export const PASSWORD = 'Test@12345';
export const KORAMANGALA = { lat: 12.9352, lng: 77.6245 };
export const NEAR_KORAMANGALA = { lat: 12.9411, lng: 77.6199 };

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}${crypto.randomBytes(2).toString('hex')}`;

export async function createUser(role: 'customer' | 'restaurant' | 'delivery' | 'admin', over: Record<string, unknown> = {}) {
  const email = `${role}-${uniq()}@test.dev`;
  const user = await UserModel.create({
    name: `${role[0].toUpperCase()}${role.slice(1)} Tester`,
    email,
    phone: '+919876543210',
    passwordHash: await hashPassword(PASSWORD),
    role,
    ...over,
  });
  return { user, email };
}

export async function login(app: Express, email: string) {
  const c = await new Client(app).init();
  const r = await c.post('/auth/login', { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`);
  return c;
}

export async function seedWorld(app: Express) {
  await ZoneModel.create({ name: 'Test Zone', city: 'Bengaluru', center: toPoint(KORAMANGALA), radiusKm: 15 });
  const owner = await createUser('restaurant');
  const restaurant = await RestaurantModel.create({
    ownerId: owner.user._id,
    name: 'Test Biryani House',
    slug: `test-biryani-${uniq()}`,
    cuisines: ['Biryani', 'North Indian'],
    tags: ['spicy'],
    phone: '+919812345678',
    fssaiLicense: '12345678901234',
    priceForTwo: 40000,
    packagingFee: 1500,
    prepTimeMinutes: 20,
    deliveryRadiusKm: 7,
    address: { line1: '1 Test Rd', locality: 'Koramangala', city: 'Bengaluru', state: 'Karnataka', pincode: '560034' },
    location: toPoint(KORAMANGALA),
    approval: 'APPROVED',
  });
  const cat = await MenuCategoryModel.create({ restaurantId: restaurant._id, name: 'Mains' });
  const paneer = await MenuItemModel.create({
    restaurantId: restaurant._id,
    categoryId: cat._id,
    name: 'Paneer Biryani',
    price: 25000,
    diet: 'veg',
    jainFriendly: false,
    spiceLevel: 2,
    tags: ['biryani'],
    optionGroups: [
      { id: 'size', name: 'Size', min: 1, max: 1, options: [{ id: 'half', name: 'Half', price: 0 }, { id: 'full', name: 'Full', price: 10000 }] },
      { id: 'addons', name: 'Add-ons', min: 0, max: 2, options: [{ id: 'raita', name: 'Raita', price: 3000, allergens: ['dairy'] }, { id: 'chicken65', name: 'Chicken 65', price: 9000, diet: 'nonveg' }] },
    ],
  });
  const chicken = await MenuItemModel.create({ restaurantId: restaurant._id, categoryId: cat._id, name: 'Chicken Biryani', price: 32000, diet: 'nonveg', tags: ['biryani'] });
  const soldOut = await MenuItemModel.create({ restaurantId: restaurant._id, categoryId: cat._id, name: 'Mutton Biryani', price: 42000, diet: 'nonveg', available: false });
  await CouponModel.create({
    code: 'SAVE50',
    type: 'flat',
    value: 5000,
    minOrder: 30000,
    validFrom: new Date(Date.now() - 86400_000),
    validTo: new Date(Date.now() + 86400_000),
    perUserLimit: 1,
  });
  await CouponModel.create({
    code: 'OLDDEAL',
    type: 'flat',
    value: 5000,
    minOrder: 0,
    validFrom: new Date(Date.now() - 10 * 86400_000),
    validTo: new Date(Date.now() - 86400_000),
  });

  const admin = await createUser('admin');
  const partner = await createUser('delivery');
  await PartnerProfileModel.create({ userId: partner.user._id, approval: 'APPROVED', online: true, location: toPoint(NEAR_KORAMANGALA), locationAt: new Date() });

  return {
    restaurant,
    items: { paneer, chicken, soldOut },
    owner: await login(app, owner.email),
    admin: await login(app, admin.email),
    partner: await login(app, partner.email),
    partnerUser: partner.user,
  };
}

export async function newCustomer(app: Express, phone = '9876543210') {
  const c = await new Client(app).init();
  const email = `cust-${uniq()}@test.dev`;
  const r = await c.post('/auth/register', { name: 'Asha Rao', email, phone, password: PASSWORD });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  const a = await c.post('/addresses', {
    label: 'Home',
    line1: 'Flat 4B, Lotus Apts',
    locality: 'Koramangala 5th Block',
    landmark: 'Near Forum',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560095',
    location: NEAR_KORAMANGALA,
  });
  return { c, addressId: a.body.address.id as string, userId: r.body.user.id as string };
}

export function paneerLine(itemId: string, quantity = 1) {
  return { menuItemId: itemId, quantity, selections: [{ groupId: 'size', optionIds: ['full'] }] };
}

/** Quote + place order + return checkout info. */
export async function placeOrder(c: Client, restaurantId: string, addressId: string, lines: object[], couponCode?: string) {
  const q = await c.post('/carts/quote', { restaurantId, addressId, lines, couponCode });
  if (q.status !== 200) throw new Error(JSON.stringify(q.body));
  const key = `test_${uniq()}`;
  const r = await c.post('/orders', { restaurantId, addressId, lines, couponCode, expectedTotal: q.body.quote.total }, { 'Idempotency-Key': key });
  return { res: r, key, quote: q.body };
}
