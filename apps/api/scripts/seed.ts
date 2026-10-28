/**
 * Development seed: fictional Bengaluru restaurants, menus, coupons, a delivery zone, and one account per role.
 * All records are flagged `demo: true`. Refuses to run in production or against a database with real users.
 *
 *   npm run seed            # seed an empty database
 *   npm run seed -- --reset # wipe a dev database that only contains demo data, then seed
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { DEFAULT_PRICING, commissionFor, computeQuote, type MenuItemInput } from '@tadka/shared';
import { env } from '../src/config/env';
import { connectDb } from '../src/lib/db';
import { hashPassword } from '../src/modules/auth/auth.routes';
import { toPoint } from '../src/models/common';
import { CouponModel, OrderModel, PaymentModel } from '../src/models/order';
import { AssignmentModel, ReviewModel } from '../src/models/ops';
import { MenuCategoryModel, MenuItemModel, PlatformConfigModel, RestaurantModel, ZoneModel } from '../src/models/restaurant';
import { AddressModel, PartnerProfileModel, UserModel } from '../src/models/user';

export const DEMO_PASSWORD = 'Tadka@2026';

const LOC = {
  koramangala: { lat: 12.9352, lng: 77.6245, locality: 'Koramangala 5th Block', pincode: '560095' },
  indiranagar: { lat: 12.9719, lng: 77.6412, locality: 'Indiranagar 100ft Rd', pincode: '560038' },
  hsr: { lat: 12.9116, lng: 77.6474, locality: 'HSR Layout Sector 2', pincode: '560102' },
  jayanagar: { lat: 12.9299, lng: 77.5838, locality: 'Jayanagar 4th Block', pincode: '560011' },
  btm: { lat: 12.9166, lng: 77.6101, locality: 'BTM Layout 2nd Stage', pincode: '560076' },
};

type Item = Omit<MenuItemInput, 'categoryId'> & { cat: string };
interface Demo {
  name: string;
  cuisines: string[];
  tags: string[];
  description: string;
  at: keyof typeof LOC;
  priceForTwo: number;
  packagingFee: number;
  prep: number;
  pureVeg?: boolean;
  sponsored?: boolean;
  rating: [number, number];
  hours?: { day: number; open: string; close: string }[];
  approval?: 'APPROVED' | 'PENDING';
  items: Item[];
}

const allDays = (open: string, close: string) => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open, close }));
const R = (rupees: number) => rupees * 100;

const SIZE = (half: number, full: number) => ({
  id: 'size',
  name: 'Portion',
  min: 1,
  max: 1,
  options: [
    { id: 'half', name: 'Half', price: R(half) },
    { id: 'full', name: 'Full', price: R(full) },
  ],
});

const RESTAURANTS: Demo[] = [
  {
    name: 'Kaveri Tiffin Room',
    cuisines: ['South Indian', 'Breakfast'],
    tags: ['comfort', 'breakfast', 'healthy'],
    description: 'Crisp dosas, soft idlis and filter coffee, made the Mysuru way since breakfast o’clock.',
    at: 'koramangala',
    priceForTwo: R(250),
    packagingFee: R(10),
    prep: 14,
    pureVeg: true,
    rating: [4.6, 1240],
    items: [
      { cat: 'Dosas', name: 'Mysore Masala Dosa', description: 'Red chutney-smeared dosa with potato palya.', price: R(110), diet: 'veg', jainFriendly: false, allergens: ['dairy'], spiceLevel: 2, tags: ['dosa', 'spicy', 'breakfast'], isBestseller: true, optionGroups: [{ id: 'extras', name: 'Extras', min: 0, max: 2, options: [{ id: 'butter', name: 'Extra butter', price: R(20), allergens: ['dairy'] }, { id: 'podi', name: 'Gunpowder podi', price: R(15), allergens: ['sesame'] }] }] },
      { cat: 'Dosas', name: 'Jain Plain Dosa', description: 'No onion, no garlic, no potato. Coconut chutney on the side.', price: R(85), diet: 'veg', jainFriendly: true, vegan: true, tags: ['dosa', 'light'] },
      { cat: 'Dosas', name: 'Ragi Dosa', description: 'Finger-millet dosa — nutty, light and filling.', price: R(95), diet: 'veg', vegan: true, jainFriendly: true, tags: ['dosa', 'healthy', 'protein'] },
      { cat: 'Idli & Vada', name: 'Idli (2) with Sambar', description: 'Steamed rice cakes, coconut chutney, drumstick sambar.', price: R(60), diet: 'veg', vegan: true, tags: ['idli', 'light', 'breakfast', 'healthy'] },
      { cat: 'Idli & Vada', name: 'Medu Vada (2)', description: 'Crisp urad-dal fritters.', price: R(70), diet: 'veg', vegan: true, tags: ['vada', 'snack'] },
      { cat: 'Rice', name: 'Bisi Bele Bath', description: 'Spiced lentil rice with ghee and boondi.', price: R(120), diet: 'veg', allergens: ['dairy'], spiceLevel: 2, tags: ['comfort', 'rice', 'spicy'] },
      { cat: 'Beverages', name: 'Filter Coffee', description: 'Chicory-blend decoction with frothy milk.', price: R(40), diet: 'veg', allergens: ['dairy'], tags: ['coffee'] },
      { cat: 'Sweets', name: 'Kesari Bath', description: 'Semolina, saffron, ghee, cashew.', price: R(60), diet: 'veg', allergens: ['dairy', 'tree_nut'], tags: ['dessert', 'sweet'] },
    ],
  },
  {
    name: 'Daawat-e-Dum',
    cuisines: ['Biryani', 'Mughlai'],
    tags: ['spicy', 'comfort'],
    description: 'Slow-sealed dum biryanis with long-grain basmati and house-ground masala.',
    at: 'hsr',
    priceForTwo: R(550),
    packagingFee: R(25),
    prep: 22,
    rating: [4.4, 3120],
    items: [
      { cat: 'Biryani', name: 'Chicken Dum Biryani', description: 'Marinated chicken, saffron rice, mirchi ka salan & raita.', price: R(280), diet: 'nonveg', allergens: ['dairy'], spiceLevel: 2, tags: ['biryani', 'spicy'], isBestseller: true, optionGroups: [SIZE(0, 140), { id: 'addons', name: 'Add-ons', min: 0, max: 3, options: [{ id: 'egg', name: 'Boiled egg', price: R(25), diet: 'egg', allergens: ['egg'] }, { id: 'raita', name: 'Extra raita', price: R(30), allergens: ['dairy'] }, { id: 'kebab', name: 'Seekh kebab (1)', price: R(90), diet: 'nonveg' }] }] },
      { cat: 'Biryani', name: 'Mutton Dum Biryani', description: 'Tender goat on the bone, kewra and fried onion.', price: R(380), diet: 'nonveg', allergens: ['dairy'], spiceLevel: 2, tags: ['biryani', 'spicy'], optionGroups: [SIZE(0, 180)] },
      { cat: 'Biryani', name: 'Veg Dum Biryani', description: 'Seasonal vegetables and paneer, layered and sealed.', price: R(220), diet: 'veg', allergens: ['dairy'], spiceLevel: 1, tags: ['biryani'], optionGroups: [SIZE(0, 110)] },
      { cat: 'Biryani', name: 'Egg Biryani', description: 'Masala-fried eggs on fragrant rice.', price: R(200), diet: 'egg', allergens: ['egg', 'dairy'], spiceLevel: 2, tags: ['biryani', 'spicy'] },
      { cat: 'Kebabs', name: 'Chicken Seekh Kebab', description: 'Charcoal-grilled minced chicken, mint chutney.', price: R(260), diet: 'nonveg', spiceLevel: 2, tags: ['kebab', 'protein', 'spicy'] },
      { cat: 'Kebabs', name: 'Paneer Tikka', description: 'Hung-curd marinated paneer, charred peppers.', price: R(240), diet: 'veg', allergens: ['dairy'], spiceLevel: 1, tags: ['protein'] },
      { cat: 'Desserts', name: 'Double ka Meetha', description: 'Hyderabadi bread pudding with dry fruits.', price: R(110), diet: 'veg', allergens: ['dairy', 'gluten', 'tree_nut'], tags: ['dessert', 'sweet'] },
    ],
  },
  {
    name: 'Chowpatty Chaat Co.',
    cuisines: ['Street Food', 'Chaat'],
    tags: ['street', 'spicy'],
    description: 'Mumbai-style chaat and pav, assembled to order so nothing goes soggy.',
    at: 'indiranagar',
    priceForTwo: R(300),
    packagingFee: R(15),
    prep: 10,
    pureVeg: true,
    rating: [4.3, 860],
    items: [
      { cat: 'Chaat', name: 'Pani Puri (8)', description: 'Packed separately: puris, spiced water, sweet chutney.', price: R(80), diet: 'veg', vegan: true, allergens: ['gluten'], spiceLevel: 2, tags: ['chaat', 'street', 'spicy'], isBestseller: true },
      { cat: 'Chaat', name: 'Sev Puri', description: 'Crunchy puris, potato, three chutneys, nylon sev.', price: R(90), diet: 'veg', allergens: ['gluten'], spiceLevel: 1, tags: ['chaat', 'street'] },
      { cat: 'Chaat', name: 'Dahi Papdi Chaat', description: 'Sweet curd, papdi, pomegranate.', price: R(110), diet: 'veg', allergens: ['dairy', 'gluten'], tags: ['chaat', 'street'] },
      { cat: 'Pav', name: 'Pav Bhaji', description: 'Buttery bhaji with two toasted pavs.', price: R(150), diet: 'veg', allergens: ['dairy', 'gluten'], spiceLevel: 1, tags: ['street', 'comfort'], optionGroups: [{ id: 'extras', name: 'Extras', min: 0, max: 2, options: [{ id: 'pav', name: 'Extra pav', price: R(25), allergens: ['gluten'] }, { id: 'cheese', name: 'Cheese', price: R(40), allergens: ['dairy'] }] }] },
      { cat: 'Pav', name: 'Jain Pav Bhaji', description: 'Raw-banana bhaji — no onion, garlic or potato.', price: R(160), diet: 'veg', jainFriendly: true, allergens: ['dairy', 'gluten'], tags: ['street'] },
      { cat: 'Pav', name: 'Vada Pav', description: 'Batata vada, dry garlic chutney, fried chilli.', price: R(50), diet: 'veg', vegan: true, allergens: ['gluten'], spiceLevel: 3, tags: ['street', 'spicy', 'snack'] },
      { cat: 'Coolers', name: 'Masala Chaas', description: 'Spiced buttermilk.', price: R(50), diet: 'veg', allergens: ['dairy'], tags: ['light'] },
    ],
  },
  {
    name: 'Kadal Coastal Kitchen',
    cuisines: ['Mangalorean', 'Seafood'],
    tags: ['spicy'],
    description: 'Ghee roasts, fish thalis and neer dosa from the Karavali coast.',
    at: 'koramangala',
    priceForTwo: R(700),
    packagingFee: R(30),
    prep: 25,
    rating: [4.5, 640],
    hours: allDays('11:30', '23:30'),
    items: [
      { cat: 'Mains', name: 'Chicken Ghee Roast', description: 'Byadgi chilli, tamarind, a lot of ghee.', price: R(340), diet: 'nonveg', allergens: ['dairy'], spiceLevel: 3, tags: ['spicy', 'protein'], isBestseller: true },
      { cat: 'Mains', name: 'Prawn Sukka', description: 'Dry coconut masala prawns.', price: R(420), diet: 'nonveg', allergens: ['shellfish'], spiceLevel: 2, tags: ['seafood', 'spicy'] },
      { cat: 'Mains', name: 'Kane Rava Fry', description: 'Semolina-crusted ladyfish.', price: R(380), diet: 'nonveg', allergens: ['fish'], spiceLevel: 1, tags: ['seafood', 'fish'] },
      { cat: 'Mains', name: 'Paneer Ghee Roast', description: 'Our ghee roast masala, vegetarian.', price: R(290), diet: 'veg', allergens: ['dairy'], spiceLevel: 3, tags: ['spicy'] },
      { cat: 'Breads & Rice', name: 'Neer Dosa (3)', description: 'Lacy rice crêpes.', price: R(70), diet: 'veg', vegan: true, jainFriendly: true, tags: ['light'] },
      { cat: 'Thalis', name: 'Fish Thali', description: 'Fish curry, fry, red rice, sukka, sol kadhi.', price: R(420), diet: 'nonveg', allergens: ['fish', 'dairy'], spiceLevel: 2, tags: ['thali', 'comfort', 'seafood'] },
    ],
  },
  {
    name: 'Green Bowl Co.',
    cuisines: ['Healthy', 'Salads'],
    tags: ['healthy', 'protein'],
    description: 'Macro-balanced bowls with calories and protein listed on every dish.',
    at: 'indiranagar',
    priceForTwo: R(600),
    packagingFee: R(20),
    prep: 12,
    sponsored: true,
    rating: [4.2, 410],
    items: [
      { cat: 'Bowls', name: 'Paneer Protein Bowl', description: 'Grilled paneer, quinoa, greens, mint yoghurt. ~32 g protein.', price: R(320), diet: 'veg', allergens: ['dairy'], tags: ['healthy', 'protein', 'light'], isBestseller: true },
      { cat: 'Bowls', name: 'Tofu Satay Bowl', description: 'Peanut-satay tofu, brown rice, slaw. Vegan.', price: R(310), diet: 'veg', vegan: true, allergens: ['soy', 'peanut'], spiceLevel: 1, tags: ['healthy', 'protein'] },
      { cat: 'Bowls', name: 'Chicken Burrito Bowl', description: 'Chipotle chicken, beans, corn, salsa. ~38 g protein.', price: R(340), diet: 'nonveg', spiceLevel: 1, tags: ['healthy', 'protein'] },
      { cat: 'Salads', name: 'Jain Garden Salad', description: 'Cucumber, capsicum, sprouts, lemon dressing. No root veg.', price: R(220), diet: 'veg', vegan: true, jainFriendly: true, tags: ['healthy', 'light', 'salad'] },
      { cat: 'Salads', name: 'Egg & Avocado Salad', description: 'Soft-boiled eggs, avocado, seeds.', price: R(290), diet: 'egg', allergens: ['egg', 'sesame'], tags: ['healthy', 'protein'] },
      { cat: 'Drinks', name: 'Cold-pressed ABC Juice', description: 'Apple, beetroot, carrot.', price: R(150), diet: 'veg', vegan: true, tags: ['healthy'] },
    ],
  },
  {
    name: 'Pind Punjab Dhaba',
    cuisines: ['North Indian', 'Punjabi'],
    tags: ['comfort'],
    description: 'Tandoor breads, dal makhani simmered overnight, and generous thalis.',
    at: 'jayanagar',
    priceForTwo: R(500),
    packagingFee: R(20),
    prep: 20,
    rating: [4.1, 1890],
    items: [
      { cat: 'Mains', name: 'Dal Makhani', description: 'Black lentils, butter, cream, 12-hour simmer.', price: R(240), diet: 'veg', allergens: ['dairy'], tags: ['comfort'], isBestseller: true },
      { cat: 'Mains', name: 'Butter Chicken', description: 'Tandoori chicken in tomato-butter gravy.', price: R(330), diet: 'nonveg', allergens: ['dairy', 'tree_nut'], spiceLevel: 1, tags: ['comfort'] },
      { cat: 'Mains', name: 'Paneer Butter Masala', description: 'Cottage cheese in silky makhani.', price: R(280), diet: 'veg', allergens: ['dairy', 'tree_nut'], tags: ['comfort', 'cheesy'] },
      { cat: 'Mains', name: 'Chole', description: 'Pindi-style chickpeas.', price: R(200), diet: 'veg', vegan: true, spiceLevel: 2, tags: ['comfort', 'protein', 'spicy'] },
      { cat: 'Breads', name: 'Butter Naan', description: 'Tandoor-baked.', price: R(60), diet: 'veg', allergens: ['dairy', 'gluten'], tags: ['bread'] },
      { cat: 'Breads', name: 'Tandoori Roti', description: 'Whole wheat.', price: R(30), diet: 'veg', vegan: true, allergens: ['gluten'], tags: ['bread'] },
      { cat: 'Thalis', name: 'Punjabi Veg Thali', description: 'Dal, sabzi, paneer, 2 rotis, rice, raita, gulab jamun.', price: R(320), diet: 'veg', allergens: ['dairy', 'gluten'], tags: ['thali', 'comfort'] },
    ],
  },
  {
    name: 'Momo Mandi',
    cuisines: ['Tibetan', 'Chinese'],
    tags: ['spicy', 'street'],
    description: 'Hand-pleated momos and thukpa, steamed, fried or pan-tossed.',
    at: 'btm',
    priceForTwo: R(350),
    packagingFee: R(15),
    prep: 15,
    rating: [4.0, 720],
    items: [
      { cat: 'Momos', name: 'Veg Steamed Momos (8)', description: 'Cabbage, carrot, spring onion. Red chilli chutney.', price: R(120), diet: 'veg', vegan: true, allergens: ['gluten', 'soy'], spiceLevel: 1, tags: ['momo', 'street'], isBestseller: true, optionGroups: [{ id: 'style', name: 'Style', min: 1, max: 1, options: [{ id: 'steamed', name: 'Steamed', price: 0 }, { id: 'fried', name: 'Fried', price: R(20) }, { id: 'tandoori', name: 'Tandoori', price: R(40), allergens: ['dairy'] }] }] },
      { cat: 'Momos', name: 'Chicken Momos (8)', description: 'Juicy minced chicken.', price: R(150), diet: 'nonveg', allergens: ['gluten', 'soy'], spiceLevel: 1, tags: ['momo', 'street'], optionGroups: [{ id: 'style', name: 'Style', min: 1, max: 1, options: [{ id: 'steamed', name: 'Steamed', price: 0 }, { id: 'fried', name: 'Fried', price: R(20) }] }] },
      { cat: 'Bowls', name: 'Chicken Thukpa', description: 'Noodle soup, greens, chilli oil.', price: R(190), diet: 'nonveg', allergens: ['gluten', 'soy'], spiceLevel: 2, tags: ['comfort', 'spicy'] },
      { cat: 'Bowls', name: 'Chilli Garlic Noodles', description: 'Wok-tossed, fiery.', price: R(170), diet: 'veg', vegan: true, allergens: ['gluten', 'soy'], spiceLevel: 3, tags: ['spicy'] },
    ],
  },
  {
    name: 'Mithai Mahal',
    cuisines: ['Desserts', 'Sweets'],
    tags: ['dessert'],
    description: 'Halwai sweets and kulfi, made fresh each morning.',
    at: 'jayanagar',
    priceForTwo: R(300),
    packagingFee: R(20),
    prep: 8,
    pureVeg: true,
    rating: [4.7, 520],
    hours: allDays('10:00', '22:00'),
    items: [
      { cat: 'Sweets', name: 'Gulab Jamun (2)', description: 'Warm, syrup-soaked.', price: R(70), diet: 'veg', allergens: ['dairy', 'gluten'], tags: ['dessert', 'sweet'], isBestseller: true },
      { cat: 'Sweets', name: 'Rasmalai (2)', description: 'Saffron milk, pistachio.', price: R(110), diet: 'veg', allergens: ['dairy', 'tree_nut'], tags: ['dessert', 'sweet'] },
      { cat: 'Sweets', name: 'Mysore Pak (250 g)', description: 'Ghee-rich gram-flour fudge.', price: R(180), diet: 'veg', jainFriendly: true, allergens: ['dairy'], tags: ['dessert', 'sweet'] },
      { cat: 'Kulfi', name: 'Malai Kulfi', description: 'Slow-reduced milk on a stick.', price: R(80), diet: 'veg', allergens: ['dairy', 'tree_nut'], tags: ['dessert'] },
    ],
  },
  {
    name: 'Tandoor Tales',
    cuisines: ['North Indian', 'Kebabs'],
    tags: ['protein'],
    description: 'Awaiting verification — visible only to admins until approved.',
    at: 'btm',
    priceForTwo: R(600),
    packagingFee: R(20),
    prep: 20,
    rating: [0, 0],
    approval: 'PENDING',
    items: [{ cat: 'Kebabs', name: 'Tandoori Chicken (Half)', description: 'Charred, smoky.', price: R(290), diet: 'nonveg', spiceLevel: 2, tags: ['protein'] }],
  },
];

const COUPONS = [
  { code: 'WELCOME100', description: '₹100 off your first order above ₹299', type: 'flat', value: R(100), maxDiscount: null, minOrder: R(299), firstOrderOnly: true, perUserLimit: 1 },
  { code: 'TADKA20', description: '20% off up to ₹120 on orders above ₹249', type: 'percent', value: 2000, maxDiscount: R(120), minOrder: R(249), perUserLimit: 3 },
  { code: 'FREEDEL', description: 'Free delivery on orders above ₹199', type: 'free_delivery', value: 0, maxDiscount: null, minOrder: R(199), perUserLimit: 5 },
] as const;

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed in production.');
  const reset = process.argv.includes('--reset');
  await connectDb();
  const db = mongoose.connection.db!;

  const realUsers = await UserModel.countDocuments({ demo: { $ne: true } });
  if (realUsers > 0) throw new Error(`Database "${db.databaseName}" has ${realUsers} non-demo user(s). Refusing to touch it.`);
  if (await UserModel.exists({ email: 'admin@tadka.dev' })) {
    if (!reset) {
      console.log('Demo data already present. Use `npm run seed -- --reset` to recreate it.');
      return;
    }
    await db.dropDatabase();
    console.log(`Dropped demo database "${db.databaseName}".`);
  }
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.syncIndexes()));

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const mkUser = (name: string, email: string, role: string, phone: string) =>
    UserModel.create({ name, email, role, phone, passwordHash, demo: true });

  await PlatformConfigModel.create({ key: 'pricing', pricing: DEFAULT_PRICING });
  await ZoneModel.create({ name: 'Bengaluru South-East', city: 'Bengaluru', center: toPoint({ lat: 12.94, lng: 77.62 }), radiusKm: 10 });
  for (const c of COUPONS)
    await CouponModel.create({ ...c, validFrom: new Date(Date.now() - 86400_000), validTo: new Date(Date.now() + 180 * 86400_000), usageLimit: null });

  const admin = await mkUser('Tadka Admin', 'admin@tadka.dev', 'admin', '+919000000001');
  const customer = await mkUser('Asha Rao', 'customer@tadka.dev', 'customer', '+919000000002');
  const rider = await mkUser('Imran Pasha', 'rider@tadka.dev', 'delivery', '+919000000003');
  const rider2 = await mkUser('Kiran Gowda', 'rider2@tadka.dev', 'delivery', '+919000000004');
  await PartnerProfileModel.create({ userId: rider._id, approval: 'APPROVED', vehicle: 'ev_scooter', vehicleNumber: 'KA01EV1234', demo: true });
  await PartnerProfileModel.create({ userId: rider2._id, approval: 'PENDING', vehicle: 'motorcycle', vehicleNumber: 'KA05AB9876', demo: true });
  const home = await AddressModel.create({
    userId: customer._id,
    label: 'Home',
    line1: 'Flat 302, Lotus Residency',
    line2: '6th Cross',
    locality: 'Koramangala 6th Block',
    landmark: 'Opp. Sony World signal',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560095',
    location: toPoint({ lat: 12.9389, lng: 77.6268 }),
  });

  const restaurants = [];
  for (const [i, d] of RESTAURANTS.entries()) {
    const owner = await mkUser(`${d.name} Owner`, i === 0 ? 'owner@tadka.dev' : `owner${i + 1}@tadka.dev`, 'restaurant', `+91900000010${i}`);
    const loc = LOC[d.at];
    const r = await RestaurantModel.create({
      ownerId: owner._id,
      name: d.name,
      slug: d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      description: d.description,
      cuisines: d.cuisines,
      tags: d.tags,
      phone: `+91980000010${i}`,
      fssaiLicense: `1122334455${String(6000 + i).padStart(4, '0')}`,
      priceForTwo: d.priceForTwo,
      packagingFee: d.packagingFee,
      prepTimeMinutes: d.prep,
      deliveryRadiusKm: 7,
      pureVeg: Boolean(d.pureVeg),
      sponsored: Boolean(d.sponsored),
      hours: d.hours ?? [],
      address: { line1: `${12 + i}, Main Road`, locality: loc.locality, city: 'Bengaluru', state: 'Karnataka', pincode: loc.pincode, location: toPoint(loc) },
      location: toPoint(loc),
      approval: d.approval ?? 'APPROVED',
      rating: { avg: d.rating[0], count: d.rating[1] },
      demo: true,
    });
    const cats = new Map<string, mongoose.Types.ObjectId>();
    for (const [ci, name] of [...new Set(d.items.map((x) => x.cat))].entries()) {
      cats.set(name, (await MenuCategoryModel.create({ restaurantId: r._id, name, sortOrder: ci }))._id);
    }
    const items = await MenuItemModel.insertMany(
      d.items.map(({ cat, ...it }) => ({ ...it, restaurantId: r._id, categoryId: cats.get(cat) })),
    );
    restaurants.push({ r, items });
  }

  // Representative history: delivered demo orders with reviews, so analytics and order history aren't empty.
  const comments = ['Hot and on time.', 'Packaging was great, nothing spilled.', 'Exactly as described.', 'A little late but tasty.', ''];
  let n = 0;
  for (const { r, items } of restaurants.slice(0, 6)) {
    for (let k = 0; k < 2; k++, n++) {
      const pick = items.filter((it) => (it.optionGroups ?? []).every((g) => g.min === 0)).slice(k, k + 2);
      const lines = pick.map((it) => ({ unitPrice: it.price, quantity: 1 }));
      const quote = computeQuote({ lines, packagingFee: r.packagingFee, distanceKm: 2.4, config: DEFAULT_PRICING });
      const c = commissionFor(quote.itemTotal, quote.packagingFee, DEFAULT_PRICING.defaultCommissionBps);
      const created = new Date(Date.now() - (n + 1) * 26 * 3600_000);
      const at = (min: number) => new Date(created.getTime() + min * 60_000);
      const timeline = (
        [
          ['PAYMENT_PENDING', 0, 'customer'],
          ['CONFIRMED', 1, 'system'],
          ['ACCEPTED', 2, 'restaurant'],
          ['PREPARING', 3, 'restaurant'],
          ['READY_FOR_PICKUP', 3 + r.prepTimeMinutes, 'restaurant'],
          ['PICKED_UP', 6 + r.prepTimeMinutes, 'delivery'],
          ['OUT_FOR_DELIVERY', 7 + r.prepTimeMinutes, 'delivery'],
          ['DELIVERED', 19 + r.prepTimeMinutes, 'delivery'],
        ] as const
      ).map(([status, m, actor]) => ({ status, at: at(m), actor, note: '' }));
      const order = await OrderModel.create({
        orderNumber: `TDK-DEMO${String(n).padStart(2, '0')}`,
        customerId: customer._id,
        restaurantId: r._id,
        restaurantSnapshot: { name: r.name, phone: r.phone, locality: r.address?.locality, location: r.location },
        deliveryAddress: { ...home.toObject(), _id: undefined },
        contactName: customer.name,
        contactPhone: customer.phone,
        items: pick.map((it) => ({ menuItemId: it._id, name: it.name, diet: it.diet, quantity: 1, basePrice: it.price, unitPrice: it.price, lineTotal: it.price, options: [] })),
        pricing: quote,
        commission: { bps: DEFAULT_PRICING.defaultCommissionBps, amount: c.commission, gst: c.gstOnCommission },
        distanceKm: 2.4,
        prepMinutes: r.prepTimeMinutes,
        status: 'DELIVERED',
        timeline,
        promisedEta: { minMinutes: r.prepTimeMinutes + 10, maxMinutes: r.prepTimeMinutes + 22, confidence: 'low', basis: 'demo', reason: 'Order placed', computedAt: at(1) },
        confirmedAt: at(1),
        acceptedAt: at(2),
        readyAt: at(3 + r.prepTimeMinutes),
        pickedUpAt: at(6 + r.prepTimeMinutes),
        deliveredAt: at(19 + r.prepTimeMinutes),
        deliveryOtp: String(crypto.randomInt(1000, 10000)),
        partnerId: rider._id,
        reviewed: k === 0,
        idempotencyKey: `demo-${n}`,
        demo: true,
        createdAt: created,
      });
      await PaymentModel.create({ orderId: order._id, customerId: customer._id, provider: 'mock', providerRef: `mock_cs_demo_${n}`, amount: quote.total, status: 'SUCCEEDED' });
      await AssignmentModel.create({
        orderId: order._id,
        restaurantId: r._id,
        partnerId: rider._id,
        status: 'DELIVERED',
        acceptedAt: at(3),
        pickedUpAt: at(6 + r.prepTimeMinutes),
        deliveredAt: at(19 + r.prepTimeMinutes),
        distanceKm: 2.4,
        earnings: { base: 2500, distancePay: 1920, total: 4420 },
      });
      if (k === 0)
        await ReviewModel.create({ orderId: order._id, restaurantId: r._id, customerId: customer._id, customerName: 'Asha', foodRating: 4 + (n % 2), deliveryRating: 5, comment: comments[n % comments.length] });
    }
  }

  console.log(`
Seeded demo data into "${db.databaseName}" (all records flagged demo: true).

  Role        Email                 Password
  admin       admin@tadka.dev       ${DEMO_PASSWORD}
  customer    customer@tadka.dev    ${DEMO_PASSWORD}
  restaurant  owner@tadka.dev       ${DEMO_PASSWORD}   (Kaveri Tiffin Room; owner2..owner9 for the others)
  delivery    rider@tadka.dev       ${DEMO_PASSWORD}   (approved)   rider2@tadka.dev (pending approval)

Coupons: ${COUPONS.map((c) => c.code).join(', ')}. Delivery zone: Bengaluru South-East (10 km around Koramangala).
These credentials are for local development only.`);
  void admin;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
