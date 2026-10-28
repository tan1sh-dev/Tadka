import clsx from 'clsx';
import { CakeSlice, Coffee, Drumstick, Fish, IceCreamCone, Salad, Sandwich, Soup, UtensilsCrossed, Wheat, type LucideIcon } from 'lucide-react';
import { hashHue } from '../lib/format';

const PALETTES: [string, string][] = [
  ['#f7c873', '#e2531d'],
  ['#f4b392', '#a2360f'],
  ['#c9e3c4', '#2f7d4f'],
  ['#fde3a7', '#b97c0c'],
  ['#f6cbc2', '#b3261e'],
  ['#e8dcc6', '#6b4f2a'],
];

const ICONS: [RegExp, LucideIcon][] = [
  [/biryani|rice|mughlai|thali|north indian|punjabi/i, Soup],
  [/dosa|south indian|breakfast|idli/i, Wheat],
  [/seafood|fish|coastal|mangalorean|prawn/i, Fish],
  [/kebab|chicken|tandoor|grill/i, Drumstick],
  [/salad|healthy|bowl/i, Salad],
  [/dessert|sweet|mithai|cake/i, CakeSlice],
  [/kulfi|ice cream/i, IceCreamCone],
  [/coffee|tea|beverage|juice/i, Coffee],
  [/street|chaat|pav|snack|momo|tibetan|chinese/i, Sandwich],
];

/**
 * Generated, licence-free artwork used when a restaurant or dish has no photo.
 * Deterministic per name so the same restaurant always looks the same.
 */
export function FoodArt({ name, hint, className, rounded = 'rounded-2xl', iconSize = 'size-10' }: { name: string; hint?: string; className?: string; rounded?: string; iconSize?: string }) {
  const h = hashHue(name);
  const [a, b] = PALETTES[h % PALETTES.length];
  const Icon = ICONS.find(([re]) => re.test(`${hint ?? ''} ${name}`))?.[1] ?? UtensilsCrossed;
  const seeds = Array.from({ length: 7 }, (_, i) => ({ x: ((h >> i) % 90) + 5, y: ((h >> (i + 3)) % 80) + 10, r: 1.2 + ((h >> i) % 3) * 0.5 }));
  return (
    <div className={clsx('relative overflow-hidden', rounded, className)} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} aria-hidden>
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        {seeds.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#1d1a16" opacity="0.18" />
        ))}
        <circle cx="62" cy="58" r="30" fill="#fff" opacity="0.92" />
        <circle cx="62" cy="58" r="23" fill="none" stroke={b} strokeOpacity="0.25" strokeWidth="1.5" />
      </svg>
      <div className="absolute grid place-items-center" style={{ left: '62%', top: '58%', transform: 'translate(-50%,-50%)' }}>
        <Icon className={iconSize} style={{ color: b }} strokeWidth={1.75} />
      </div>
    </div>
  );
}

export function CoverImage({ src, name, hint, className, rounded, iconSize }: { src?: string; name: string; hint?: string; className?: string; rounded?: string; iconSize?: string }) {
  if (src) return <img src={src} alt="" loading="lazy" className={clsx('object-cover', rounded ?? 'rounded-2xl', className)} />;
  return <FoodArt name={name} hint={hint} className={className} rounded={rounded} iconSize={iconSize} />;
}
