import { haversineKm, type LatLng } from '@tadka/shared';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { fromPoint } from '../models/common';
import { ZoneModel } from '../models/restaurant';

export async function findZoneFor(p: LatLng) {
  const zones = await ZoneModel.find({ active: true }).lean();
  return zones.find((z) => haversineKm(fromPoint(z.center)!, p) <= z.radiusKm) ?? null;
}

export const mapsConfigured = () => Boolean(env.GOOGLE_MAPS_SERVER_KEY);

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Two-wheeler travel time from Google Routes API. Returns null when not configured or on any failure,
 * so callers degrade to the haversine speed model rather than blocking on an external service.
 */
export async function routeMinutes(from: LatLng, to: LatLng): Promise<number | null> {
  if (!env.GOOGLE_MAPS_SERVER_KEY) return null;
  try {
    const body = {
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: 'TWO_WHEELER',
      routingPreference: 'TRAFFIC_AWARE',
    };
    const data = (await fetchJson(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': env.GOOGLE_MAPS_SERVER_KEY,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
        },
        body: JSON.stringify(body),
      },
      2500,
    )) as { routes?: { duration?: string }[] };
    const d = data.routes?.[0]?.duration;
    return d ? Number(d.replace('s', '')) / 60 : null;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Routes API unavailable; using speed model');
    return null;
  }
}

export async function geocode(address: string): Promise<{ location: LatLng; formatted: string } | null> {
  if (!env.GOOGLE_MAPS_SERVER_KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?region=in&components=country:IN&address=${encodeURIComponent(
    address,
  )}&key=${env.GOOGLE_MAPS_SERVER_KEY}`;
  try {
    const data = (await fetchJson(url, {}, 3000)) as {
      status: string;
      results: { formatted_address: string; geometry: { location: LatLng } }[];
    };
    const r = data.status === 'OK' ? data.results[0] : undefined;
    return r ? { location: r.geometry.location, formatted: r.formatted_address } : null;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Geocoding failed');
    return null;
  }
}
