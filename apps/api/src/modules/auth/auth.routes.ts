import { Router } from 'express';
import { hash, verify } from '@node-rs/argon2';
import { loginSchema, registerSchema } from '@tadka/shared';
import { AppError, parse } from '../../lib/errors';
import {
  authenticate,
  clearSessionCookie,
  currentUser,
  issueCsrf,
  requireAuth,
  setSessionCookie,
  signSession,
} from '../../middleware/auth';
import { authLimiter } from '../../middleware/security';
import { PartnerProfileModel, UserModel, type UserDoc } from '../../models/user';
import { RestaurantModel } from '../../models/restaurant';

// argon2id with OWASP-recommended baseline parameters (19 MiB, t=2, p=1).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
// Pre-computed hash used to keep timing similar when the email does not exist.
let dummyHash: string | null = null;

export function serializeUser(u: Pick<UserDoc, '_id' | 'name' | 'email' | 'phone' | 'role' | 'smsOptIn' | 'dietary' | 'status'>) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    smsOptIn: u.smsOptIn,
    dietary: { enabled: u.dietary?.enabled ?? false, diet: u.dietary?.diet ?? 'any', avoidAllergens: u.dietary?.avoidAllergens ?? [] },
  };
}

export const hashPassword = (pw: string) => hash(pw, ARGON);

export const authRouter = Router();

authRouter.get('/csrf', (req, res) => {
  res.json({ csrfToken: issueCsrf(req, res) });
});

authRouter.post('/register', authLimiter, async (req, res) => {
  const input = parse(registerSchema, req.body);
  if (await UserModel.exists({ email: input.email }))
    throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Try logging in.');
  const user = await UserModel.create({ ...input, passwordHash: await hashPassword(input.password) });
  if (user.role === 'delivery') await PartnerProfileModel.create({ userId: user._id });
  setSessionCookie(res, signSession(user));
  res.status(201).json({ user: serializeUser(user) });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const user = await UserModel.findOne({ email }).select('+passwordHash');
  if (!user) {
    dummyHash ??= await hashPassword('timing-equaliser');
    await verify(dummyHash, password).catch(() => false);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  const ok = await verify(user.passwordHash, password).catch(() => false);
  if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  if (user.status !== 'active') throw new AppError(403, 'SUSPENDED', 'This account is suspended. Contact support.');
  setSessionCookie(res, signSession(user));
  res.json({ user: serializeUser(user) });
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.post('/logout-all', authenticate, requireAuth, async (req, res) => {
  await UserModel.updateOne({ _id: currentUser(req).id }, { $inc: { tokenVersion: 1 } });
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', authenticate, async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const user = await UserModel.findById(req.user.id);
  if (!user) return res.json({ user: null });
  const extra: Record<string, unknown> = {};
  if (user.role === 'restaurant') {
    const r = await RestaurantModel.findOne({ ownerId: user._id }).select('_id name slug approval').lean();
    extra.restaurant = r ? { id: String(r._id), name: r.name, slug: r.slug, approval: r.approval } : null;
  }
  if (user.role === 'delivery') {
    const p = await PartnerProfileModel.findOne({ userId: user._id }).select('approval online').lean();
    extra.partner = p ? { approval: p.approval, online: p.online } : null;
  }
  res.json({ user: { ...serializeUser(user), ...extra } });
});
