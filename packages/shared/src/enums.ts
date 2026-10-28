export const ROLES = ['customer', 'restaurant', 'delivery', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ORDER_STATUSES = [
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
];

export const PAYMENT_STATUSES = ['CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REFUND_STATUSES = ['NONE', 'PENDING', 'PARTIAL', 'REFUNDED', 'FAILED'] as const;
export type OrderRefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_RECORD_STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'REJECTED', 'FAILED'] as const;
export type RefundRecordStatus = (typeof REFUND_RECORD_STATUSES)[number];

export const ASSIGNMENT_STATUSES = ['OFFERED', 'ACCEPTED', 'PICKED_UP', 'DELIVERED', 'DECLINED', 'EXPIRED', 'CANCELLED'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const ITEM_DIETS = ['veg', 'egg', 'nonveg'] as const;
export type ItemDiet = (typeof ITEM_DIETS)[number];

export const PROFILE_DIETS = ['any', 'eggetarian', 'veg', 'jain', 'vegan'] as const;
export type ProfileDiet = (typeof PROFILE_DIETS)[number];

export const ALLERGENS = ['peanut', 'tree_nut', 'dairy', 'gluten', 'soy', 'egg', 'fish', 'shellfish', 'sesame'] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  peanut: 'Peanut',
  tree_nut: 'Tree nuts',
  dairy: 'Dairy',
  gluten: 'Gluten',
  soy: 'Soy',
  egg: 'Egg',
  fish: 'Fish',
  shellfish: 'Shellfish',
  sesame: 'Sesame',
};

export const NOTIFICATION_EVENTS = [
  'ORDER_PLACED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_FAILED',
  'ORDER_ACCEPTED',
  'ORDER_REJECTED',
  'ORDER_READY',
  'PARTNER_ASSIGNED',
  'ORDER_PICKED_UP',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
  'REFUND_UPDATED',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
