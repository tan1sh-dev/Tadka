import type { OrderStatus } from './enums';

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line distance understates city roads; 1.35 is a conservative detour factor. */
export const ROAD_FACTOR = 1.35;
export const DEFAULT_SPEED_KMPH = 18;

export function travelMinutes(straightKm: number, speedKmph = DEFAULT_SPEED_KMPH): number {
  return ((straightKm * ROAD_FACTOR) / speedKmph) * 60;
}

export interface EtaInput {
  status: OrderStatus;
  now: Date;
  prepMinutes: number;
  acceptedAt?: Date | null;
  readyAt?: Date | null;
  pickedUpAt?: Date | null;
  restaurantToCustomerKm: number;
  /** Partner's live distance; only pass when location is fresh. */
  partnerToRestaurantKm?: number | null;
  partnerToCustomerKm?: number | null;
  /** Minutes from routing provider if available (overrides speed model for the last leg). */
  routedLastLegMinutes?: number | null;
  speedKmph?: number;
}

export interface EtaEstimate {
  minMinutes: number;
  maxMinutes: number;
  confidence: 'low' | 'medium' | 'high';
  basis: string;
}

const PICKUP_HANDOFF_MIN = 4;

/**
 * Explained ETA: returns a range, not a single number, with the basis used.
 * The spread narrows as the order progresses and as live data becomes available.
 */
export function estimateEta(i: EtaInput): EtaEstimate | null {
  const speed = i.speedKmph ?? DEFAULT_SPEED_KMPH;
  const sinceMin = (d?: Date | null) => (d ? (i.now.getTime() - new Date(d).getTime()) / 60000 : 0);
  const lastLeg = i.routedLastLegMinutes ?? travelMinutes(i.restaurantToCustomerKm, speed);
  let central: number;
  let spread: number;
  let basis: string;
  let confidence: EtaEstimate['confidence'];

  switch (i.status) {
    case 'PAYMENT_PENDING':
    case 'PAYMENT_FAILED':
    case 'CONFIRMED':
      central = i.prepMinutes + PICKUP_HANDOFF_MIN + lastLeg;
      spread = 0.3;
      confidence = 'low';
      basis = 'Typical prep time at this restaurant + distance';
      break;
    case 'ACCEPTED':
    case 'PREPARING': {
      const remainingPrep = Math.max(2, i.prepMinutes - sinceMin(i.acceptedAt));
      central = remainingPrep + PICKUP_HANDOFF_MIN + lastLeg;
      spread = 0.2;
      confidence = 'medium';
      basis = 'Kitchen is preparing your food';
      break;
    }
    case 'READY_FOR_PICKUP': {
      const toRestaurant =
        i.partnerToRestaurantKm != null ? travelMinutes(i.partnerToRestaurantKm, speed) : PICKUP_HANDOFF_MIN + 3;
      central = toRestaurant + PICKUP_HANDOFF_MIN + lastLeg;
      spread = 0.2;
      confidence = 'medium';
      basis = i.partnerToRestaurantKm != null ? 'Food is ready; partner is heading to the restaurant' : 'Food is ready; waiting for a partner';
      break;
    }
    case 'PICKED_UP':
    case 'OUT_FOR_DELIVERY':
      if (i.partnerToCustomerKm != null) {
        central = travelMinutes(i.partnerToCustomerKm, speed);
        spread = 0.15;
        confidence = 'high';
        basis = "Based on the partner's live location";
      } else {
        central = Math.max(2, lastLeg - sinceMin(i.pickedUpAt));
        spread = 0.35;
        confidence = 'low';
        basis = 'Live location unavailable — estimated from pickup time';
      }
      break;
    default:
      return null;
  }

  const minWidth = 4;
  let min = Math.max(1, Math.round(central * (1 - spread)));
  let max = Math.round(central * (1 + spread));
  if (max - min < minWidth) {
    max = min + minWidth;
  }
  if (min < 1) min = 1;
  return { minMinutes: min, maxMinutes: max, confidence, basis };
}
