import crypto from 'node:crypto';
import type { CookieOptions, NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@tadka/shared';
import { env, isProd } from '../config/env';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { UserModel } from '../models/user';

export const SESSION_COOKIE = 'tadka_session';
export const CSRF_COOKIE = 'tadka_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  phone: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

interface TokenPayload {
  sub: string;
  role: Role;
  tv: number;
}

const baseCookie: CookieOptions = { sameSite: 'lax', secure: isProd, path: '/' };

export function signSession(user: { _id: unknown; role: Role; tokenVersion: number }): string {
  const payload: TokenPayload = { sub: String(user._id), role: user.role, tv: user.tokenVersion };
  return jwt.sign(payload, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: SESSION_TTL_SEC });
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...baseCookie, httpOnly: true, maxAge: SESSION_TTL_SEC * 1000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...baseCookie, httpOnly: true });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as TokenPayload;
  } catch {
    return null;
  }
}

/** Resolves a session token to an active user, rejecting revoked tokens (tokenVersion mismatch). */
export async function resolveSession(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = await UserModel.findById(payload.sub).select('role status tokenVersion name phone').lean();
  if (!user || user.status !== 'active' || user.tokenVersion !== payload.tv) return null;
  return { id: String(user._id), role: user.role as Role, name: user.name, phone: user.phone };
}

/** Attaches req.user when a valid session cookie is present. Never throws for anonymous requests. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  req.user = (await resolveSession(req.cookies?.[SESSION_COOKIE])) ?? undefined;
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Issues a readable CSRF cookie (double-submit pattern). */
export function issueCsrf(_req: Request, res: Response): string {
  const token = crypto.randomBytes(24).toString('base64url');
  res.cookie(CSRF_COOKIE, token, { ...baseCookie, httpOnly: false, maxAge: SESSION_TTL_SEC * 1000 });
  return token;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (
    !cookie ||
    !header ||
    cookie.length !== header.length ||
    !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header))
  ) {
    return next(new AppError(403, 'CSRF', 'Security token missing or invalid. Refresh the page and try again.'));
  }
  next();
}
