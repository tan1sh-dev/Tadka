import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ItemDiet } from '@tadka/shared';
import type { LatLng } from './types';

/** localStorage can be unavailable (private mode, blocked storage); fall back to memory. */
const safeStorage = createJSONStorage(() => {
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  }
});

export interface DeliveryLocation extends LatLng {
  label: string;
  addressId?: string;
}

interface LocationState {
  location: DeliveryLocation | null;
  setLocation: (l: DeliveryLocation | null) => void;
}

export const useLocationStore = create<LocationState>()(
  persist((set) => ({ location: null, setLocation: (location) => set({ location }) }), { name: 'tadka-location', storage: safeStorage }),
);

export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  diet: ItemDiet;
  quantity: number;
  selections: { groupId: string; optionIds: string[] }[];
  optionsLabel: string;
  /** Display-only estimate; the server quote is authoritative. */
  unitPrice: number;
}

interface CartState {
  restaurant: { id: string; slug: string; name: string } | null;
  lines: CartLine[];
  couponCode: string;
  instructions: string;
  add: (r: { id: string; slug: string; name: string }, line: Omit<CartLine, 'key'>) => void;
  setQty: (key: string, quantity: number) => void;
  setCoupon: (code: string) => void;
  setInstructions: (s: string) => void;
  clear: () => void;
}

const lineKey = (l: Pick<CartLine, 'menuItemId' | 'selections'>) =>
  `${l.menuItemId}|${l.selections
    .map((s) => `${s.groupId}:${[...s.optionIds].sort().join(',')}`)
    .sort()
    .join(';')}`;

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      restaurant: null,
      lines: [],
      couponCode: '',
      instructions: '',
      add: (restaurant, line) => {
        const key = lineKey(line);
        const state = get();
        const sameRestaurant = state.restaurant?.id === restaurant.id;
        const lines = sameRestaurant ? state.lines : [];
        const existing = lines.find((l) => l.key === key);
        set({
          restaurant,
          couponCode: sameRestaurant ? state.couponCode : '',
          lines: existing
            ? lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(20, l.quantity + line.quantity) } : l))
            : [...lines, { ...line, key }],
        });
      },
      setQty: (key, quantity) => {
        const lines = quantity <= 0 ? get().lines.filter((l) => l.key !== key) : get().lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(20, quantity) } : l));
        set(lines.length ? { lines } : { lines, restaurant: null, couponCode: '' });
      },
      setCoupon: (couponCode) => set({ couponCode }),
      setInstructions: (instructions) => set({ instructions }),
      clear: () => set({ lines: [], restaurant: null, couponCode: '', instructions: '' }),
    }),
    { name: 'tadka-cart', storage: safeStorage },
  ),
);

export const cartCount = (lines: CartLine[]) => lines.reduce((s, l) => s + l.quantity, 0);
