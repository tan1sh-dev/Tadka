import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { badRequest } from '../lib/errors';

/**
 * Rejects request bodies and route params containing MongoDB operator keys ($gt, $where…) or dotted paths.
 * Zod schemas already coerce shapes; this is defence in depth for any handler that forgets.
 */
export const rejectOperatorKeys: RequestHandler = (req, _res, next) => {
  const bad = (v: unknown, depth = 0): boolean => {
    if (depth > 20 || v === null || typeof v !== 'object') return false;
    if (Array.isArray(v)) return v.some((x) => bad(x, depth + 1));
    return Object.entries(v as Record<string, unknown>).some(
      ([k, x]) => k.startsWith('$') || k.includes('.') || bad(x, depth + 1),
    );
  };
  if (bad(req.body) || bad(req.query) || bad(req.params)) return next(badRequest('Invalid characters in request'));
  next();
};

const skip = () => env.NODE_ENV === 'test';
const message = { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } };

export const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, skip, message });
export const searchLimiter = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false, skip, message });
export const apiLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false, skip, message });
export const locationLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, skip, message });
