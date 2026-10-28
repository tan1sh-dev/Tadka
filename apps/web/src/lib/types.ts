import type { DietaryProfile, ItemDiet, OrderStatus, Quote, Role } from '@tadka/shared';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  smsOptIn: boolean;
  dietary: DietaryProfile;
  restaurant?: { id: string; name: string; slug: string; approval: string } | null;
  partner?: { approval: string; online: boolean } | null;
}

export interface Address {
  id: string;
  label: string;
  line1: string;
  line2?: string;
  locality: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  location: LatLng;
  serviceable?: boolean;
}

export interface Eta {
  minMinutes: number;
  maxMinutes: number;
  confidence?: 'low' | 'medium' | 'high';
  basis?: string;
  reason?: string;
  computedAt?: string;
}

export interface RestaurantCard {
  id: string;
  slug: string;
  name: string;
  cuisines: string[];
  imageUrl: string;
  rating: { avg: number; count: number };
  priceForTwo: number;
  allInForTwo: number;
  deliveryFee: number | null;
  distanceKm: number;
  eta: Eta;
  open: boolean;
  pureVeg: boolean;
  locality: string;
  sponsored: boolean;
  demo: boolean;
  why: string[];
  matchedItems: { name: string; price: number }[];
}

export interface OptionGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: { id: string; name: string; price: number; diet?: ItemDiet; allergens?: string[]; available: boolean }[];
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  diet: ItemDiet;
  vegan: boolean;
  jainFriendly: boolean;
  allergens: string[];
  spiceLevel: number;
  tags: string[];
  imageUrl: string;
  available: boolean;
  isBestseller: boolean;
  optionGroups: OptionGroup[];
  dietary: { ok: boolean; reasons: string[] };
}

export interface RestaurantDetail {
  restaurant: {
    id: string;
    slug: string;
    name: string;
    description: string;
    cuisines: string[];
    imageUrl: string;
    rating: { avg: number; count: number };
    priceForTwo: number;
    packagingFee: number;
    pureVeg: boolean;
    address: { locality: string; city: string; line1: string };
    location: LatLng;
    hours: { day: number; open: string; close: string }[];
    open: boolean;
    paused: boolean;
    fssaiLicense: string;
    distanceKm: number | null;
    deliverable: boolean | null;
    deliveryFee: number | null;
    eta: Eta | null;
    demo: boolean;
  };
  fees: {
    platformFee: number;
    freeDeliveryAbove: number | null;
    smallCartThreshold: number;
    smallCartFee: number;
    foodGstBps: number;
    feeGstBps: number;
  };
  categories: { id: string; name: string }[];
  items: MenuItem[];
  reviews: { id: string; name: string; rating: number; comment: string; createdAt: string }[];
  dietaryProfile: DietaryProfile | null;
}

export interface Blocker {
  code: string;
  message: string;
  lineIndex?: number;
}

export interface QuoteResponse {
  quote: Quote;
  lines: { menuItemId: string; name: string; quantity: number; unitPrice: number; lineTotal: number; dietaryReasons: string[] }[];
  distanceKm: number;
  blockers: Blocker[];
  coupon: { code: string; description: string } | null;
  couponError: { code: string; message: string } | null;
  canOrder: boolean;
}

export interface TimelineEntry {
  status: OrderStatus;
  at: string;
  actor: string;
  note: string;
}

export interface LiveLocation {
  lat: number;
  lng: number;
  accuracy?: number | null;
  at: string;
  source: 'gps' | 'demo';
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  statusLabel: string;
  restaurant: { id: string; name: string; locality: string; location: LatLng };
  items: { menuItemId: string; name: string; diet: ItemDiet; quantity: number; unitPrice: number; lineTotal: number; options: { groupName: string; name: string; price: number }[] }[];
  pricing?: Quote;
  coupon: { code: string; discount: number } | null;
  timeline: TimelineEntry[];
  eta: Eta | null;
  promisedEta?: Eta | null;
  instructions: string;
  refundStatus: string;
  refundedAmount: number;
  reviewed: boolean;
  distanceKm: number;
  createdAt: string;
  deliveredAt?: string;
  cancelReason?: string;
  delivery: { status: string; partnerName: string | null; lastLocation: LiveLocation | null } | null;
  deliveryAddress?: Omit<Address, 'id' | 'label' | 'state'> & { location: LatLng };
  deliveryOtp?: string;
  customerName?: string;
  customerPhone?: string;
  restaurantPhone?: string;
  dropLocality?: string;
  earnings?: { base: number; distancePay: number; total: number } | null;
  commission?: { bps: number; amount: number; gst: number };
}
