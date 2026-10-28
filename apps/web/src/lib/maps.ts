/* Minimal Google Maps JS loader. Uses only the public, referrer-restricted browser key. */

export const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || '';
export const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || undefined;

// The Maps JS API is loaded at runtime; we keep its surface untyped rather than pulling in @types/google.maps.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GoogleNs = any;

declare global {
  interface Window {
    google?: GoogleNs;
    __tadkaMapsCb?: () => void;
  }
}

let loading: Promise<GoogleNs> | null = null;

export function loadGoogleMaps(): Promise<GoogleNs> {
  if (!MAPS_KEY) return Promise.reject(new Error('MAPS_NOT_CONFIGURED'));
  if (window.google?.maps) return Promise.resolve(window.google);
  loading ??= new Promise((resolve, reject) => {
    window.__tadkaMapsCb = () => resolve(window.google);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&libraries=places&region=IN&language=en-IN&loading=async&callback=__tadkaMapsCb`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('MAPS_LOAD_FAILED'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export function navigationUrl(dest: { lat: number; lng: number }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=two-wheeler`;
}
