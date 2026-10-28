import { Schema } from 'mongoose';

/** GeoJSON point. Coordinates are [lng, lat] as MongoDB requires. */
export const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point', required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

export const toPoint = (p: { lat: number; lng: number }) => ({ type: 'Point' as const, coordinates: [p.lng, p.lat] as [number, number] });
export const fromPoint = (p: { coordinates: number[] } | null | undefined) =>
  p ? { lat: p.coordinates[1], lng: p.coordinates[0] } : null;

export const addressFields = {
  line1: { type: String, required: true },
  line2: { type: String, default: '' },
  locality: { type: String, required: true },
  landmark: { type: String, default: '' },
  city: { type: String, required: true },
  state: { type: String, required: true },
  pincode: { type: String, required: true },
  location: { type: pointSchema, required: true },
};
