import type { ProfileDiet } from './enums';
import type { Paise } from './money';

export interface ParsedCraving {
  /** Free-text words left after extracting intents (matched against names/cuisines/items). */
  terms: string[];
  /** Normalised tags matched against menu-item and restaurant tags. */
  tags: string[];
  maxPrice: Paise | null;
  diet: ProfileDiet | null;
  quick: boolean;
  /** Human-readable interpretation, shown as "Showing: …" */
  understood: string[];
}

const TAG_SYNONYMS: Record<string, string[]> = {
  spicy: ['spicy', 'hot', 'teekha', 'chatpata', 'fiery'],
  healthy: ['healthy', 'light', 'diet', 'salad', 'low-cal', 'lowcal', 'clean'],
  comfort: ['comfort', 'homely', 'ghar', 'homestyle', 'home-style'],
  dessert: ['dessert', 'sweet', 'meetha', 'sweets'],
  cheesy: ['cheesy', 'cheese'],
  protein: ['protein', 'high-protein', 'gym'],
  breakfast: ['breakfast', 'nashta', 'morning'],
  street: ['street', 'chaat', 'snack', 'snacks'],
};

const DIET_WORDS: [RegExp, ProfileDiet][] = [
  [/\bjain\b/, 'jain'],
  [/\bvegan\b/, 'vegan'],
  [/\b(eggless|egg-free|no egg|pure veg|veg|vegetarian)\b/, 'veg'],
  [/\beggetarian\b/, 'eggetarian'],
];

const STOPWORDS = new Set(
  'i want some something a an the for me to eat with and or of in under below less than within near nearby food craving please quick fast rs inr budget'.split(
    ' ',
  ),
);

/** Deterministic craving parser. No ML: predictable, testable, explainable. */
export function parseCraving(raw: string): ParsedCraving {
  let q = raw.toLowerCase().replace(/₹/g, ' rs ').replace(/\s+/g, ' ').trim();
  const understood: string[] = [];

  let maxPrice: Paise | null = null;
  const price = q.match(/(?:under|below|less than|within|<|upto|up to|max)\s*(?:rs\.?\s*)?(\d{2,5})/);
  if (price) {
    maxPrice = Number(price[1]) * 100;
    q = q.replace(price[0], ' ');
    understood.push(`dishes under ₹${price[1]}`);
  }

  let diet: ProfileDiet | null = null;
  for (const [re, d] of DIET_WORDS) {
    if (re.test(q)) {
      diet = d;
      q = q.replace(re, ' ');
      understood.push(d === 'veg' ? 'vegetarian' : d);
      break;
    }
  }

  const quick = /\b(quick|fast|asap|hurry)\b/.test(q);
  if (quick) understood.push('fastest delivery first');

  const tags: string[] = [];
  const words = q.split(/[^a-z0-9-]+/).filter(Boolean);
  const terms: string[] = [];
  for (const w of words) {
    const tag = Object.entries(TAG_SYNONYMS).find(([, syns]) => syns.includes(w))?.[0];
    if (tag) {
      if (!tags.includes(tag)) {
        tags.push(tag);
        understood.push(tag);
      }
    } else if (!STOPWORDS.has(w) && w.length > 1 && !/^\d+$/.test(w)) {
      terms.push(w);
    }
  }
  if (terms.length) understood.unshift(`"${terms.join(' ')}"`);
  return { terms, tags, maxPrice, diet, quick, understood };
}
