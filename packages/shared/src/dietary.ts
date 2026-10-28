import { ALLERGEN_LABELS, type Allergen, type ItemDiet, type ProfileDiet } from './enums';

export interface DietaryProfile {
  enabled: boolean;
  diet: ProfileDiet;
  avoidAllergens: Allergen[];
}

export interface DietaryFacts {
  diet: ItemDiet;
  vegan?: boolean;
  jainFriendly?: boolean;
  allergens?: Allergen[];
}

export interface DietaryCheck {
  ok: boolean;
  reasons: string[];
}

export const PROFILE_DIET_LABELS: Record<ProfileDiet, string> = {
  any: 'No restriction',
  eggetarian: 'Eggetarian (no meat, fish)',
  veg: 'Vegetarian (no egg, meat, fish)',
  jain: 'Jain',
  vegan: 'Vegan',
};

/**
 * Dietary Guard: decides whether an item (with its chosen options merged in) conflicts with a profile.
 * Facts are merchant-declared; callers should surface that caveat in the UI.
 */
export function checkDietary(profile: DietaryProfile | undefined | null, facts: DietaryFacts): DietaryCheck {
  if (!profile || !profile.enabled) return { ok: true, reasons: [] };
  const reasons: string[] = [];
  const { diet } = facts;

  switch (profile.diet) {
    case 'eggetarian':
      if (diet === 'nonveg') reasons.push('Contains meat or fish');
      break;
    case 'veg':
      if (diet !== 'veg') reasons.push(diet === 'egg' ? 'Contains egg' : 'Contains meat or fish');
      break;
    case 'jain':
      if (diet !== 'veg') reasons.push(diet === 'egg' ? 'Contains egg' : 'Contains meat or fish');
      else if (!facts.jainFriendly) reasons.push('Not marked Jain-friendly by the restaurant');
      break;
    case 'vegan':
      if (diet !== 'veg') reasons.push(diet === 'egg' ? 'Contains egg' : 'Contains meat or fish');
      else if (!facts.vegan) reasons.push('Not marked vegan by the restaurant');
      break;
    case 'any':
      break;
  }

  const hits = (facts.allergens ?? []).filter((a) => profile.avoidAllergens.includes(a));
  for (const a of hits) reasons.push(`Contains ${ALLERGEN_LABELS[a].toLowerCase()}`);

  return { ok: reasons.length === 0, reasons };
}

const DIET_RANK: Record<ItemDiet, number> = { veg: 0, egg: 1, nonveg: 2 };

/** Merges an item's facts with the facts of selected options (the "strictest" diet wins). */
export function mergeDietaryFacts(base: DietaryFacts, options: Partial<DietaryFacts>[]): DietaryFacts {
  let diet = base.diet;
  let vegan = base.vegan ?? false;
  let jainFriendly = base.jainFriendly ?? false;
  const allergens = new Set(base.allergens ?? []);
  for (const o of options) {
    if (o.diet && DIET_RANK[o.diet] > DIET_RANK[diet]) diet = o.diet;
    if (o.vegan === false) vegan = false;
    if (o.jainFriendly === false) jainFriendly = false;
    for (const a of o.allergens ?? []) allergens.add(a);
  }
  return { diet, vegan, jainFriendly, allergens: [...allergens] };
}
