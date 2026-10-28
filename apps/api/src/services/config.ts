import { DEFAULT_PRICING, type PricingConfig } from '@tadka/shared';
import { PlatformConfigModel } from '../models/restaurant';

let cache: { value: PricingConfig; at: number } | null = null;
const TTL_MS = 15_000;

export async function getPricingConfig(): Promise<PricingConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const doc = await PlatformConfigModel.findOne({ key: 'pricing' }).lean();
  const value = { ...DEFAULT_PRICING, ...((doc?.pricing as Partial<PricingConfig>) ?? {}) };
  cache = { value, at: Date.now() };
  return value;
}

export async function setPricingConfig(value: PricingConfig): Promise<PricingConfig> {
  await PlatformConfigModel.updateOne({ key: 'pricing' }, { $set: { pricing: value } }, { upsert: true });
  cache = null;
  return getPricingConfig();
}

export function clearConfigCache() {
  cache = null;
}
