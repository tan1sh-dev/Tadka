import { formatINR } from '@tadka/shared';

export const inr = (paise: number | null | undefined, whole = false) => formatINR(paise ?? 0, { whole });

const IST = 'Asia/Kolkata';

export function formatTime(d: string | Date) {
  return new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: IST });
}

export function formatDateTime(d: string | Date) {
  return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: IST });
}

export function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });
}

export function relativeSeconds(fromIso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

/** "7:42 pm – 7:55 pm" arrival window from a minutes range. */
export function arrivalWindow(minMinutes: number, maxMinutes: number, base = Date.now()) {
  const t = (m: number) =>
    new Date(base + m * 60_000).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST });
  return `${t(minMinutes)} – ${t(maxMinutes)}`;
}

export function hashHue(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong';
}
