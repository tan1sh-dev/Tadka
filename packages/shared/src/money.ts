/** All money is integer paise (1 INR = 100 paise). */
export type Paise = number;

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function formatINR(paise: Paise, opts: { whole?: boolean } = {}): string {
  const rupees = paise / 100;
  if (opts.whole || Number.isInteger(rupees)) return inrWhole.format(Math.round(rupees));
  return inr.format(rupees);
}

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

/** Basis points: 10000 = 100%. Rounds half-up to the nearest paisa. */
export function applyBps(amount: Paise, bps: number): Paise {
  return Math.round((amount * bps) / 10000);
}
