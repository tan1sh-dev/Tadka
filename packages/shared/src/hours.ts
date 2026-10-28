export interface OpeningWindow {
  day: number; // 0 = Sunday, in IST
  open: string; // "HH:MM"
  close: string; // "HH:MM"; may be <= open to mean "past midnight"
}

export const IST_TIMEZONE = 'Asia/Kolkata';

function istParts(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { day: days.indexOf(get('weekday')), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Empty hours means "always open" (useful for cloud kitchens and dev). */
export function isOpenAt(hours: OpeningWindow[], now: Date): boolean {
  if (hours.length === 0) return true;
  const { day, minutes } = istParts(now);
  const prevDay = (day + 6) % 7;
  return hours.some((w) => {
    const o = toMin(w.open);
    const c = toMin(w.close);
    if (c > o) return w.day === day && minutes >= o && minutes < c;
    // overnight window: open today until midnight, or opened yesterday and still before close
    return (w.day === day && minutes >= o) || (w.day === prevDay && minutes < c);
  });
}
