import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1'));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    APP_BASE_URL: z.string().url().default('http://localhost:4000'),
    MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/tadka?replicaSet=rs0'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    MOCK_PAYMENT_SECRET: z.string().min(16).default('dev-only-mock-payment-secret'),

    SMS_PROVIDER: z.enum(['mock', 'twilio']).default('mock'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),
    TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),

    GOOGLE_MAPS_SERVER_KEY: z.string().optional(),

    ALLOW_DEMO_LOCATION: bool,
    JOBS_ENABLED: bool,
    JOB_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
  })
  .superRefine((e, ctx) => {
    const prod = e.NODE_ENV === 'production';
    if (prod && !e.JWT_SECRET) ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'required in production' });
    if (prod && e.PAYMENT_PROVIDER === 'mock')
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'mock payments are not allowed in production' });
    if (e.PAYMENT_PROVIDER === 'stripe' && (!e.STRIPE_SECRET_KEY || !e.STRIPE_WEBHOOK_SECRET))
      ctx.addIssue({ code: 'custom', path: ['STRIPE_SECRET_KEY'], message: 'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required' });
    if (
      e.SMS_PROVIDER === 'twilio' &&
      (!e.TWILIO_ACCOUNT_SID || !e.TWILIO_AUTH_TOKEN || !(e.TWILIO_FROM_NUMBER || e.TWILIO_MESSAGING_SERVICE_SID))
    )
      ctx.addIssue({ code: 'custom', path: ['TWILIO_ACCOUNT_SID'], message: 'Twilio credentials and a sender are required' });
  });

export type Env = z.infer<typeof schema> & { JWT_SECRET: string; ALLOW_DEMO_LOCATION: boolean; JOBS_ENABLED: boolean };

function load(): Env {
  // Blank values in .env (e.g. `STRIPE_SECRET_KEY=`) mean "not set".
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  const e = parsed.data;
  const prod = e.NODE_ENV === 'production';
  return {
    ...e,
    JWT_SECRET: e.JWT_SECRET ?? 'dev-only-insecure-jwt-secret-change-me-0123456789',
    // Demo location simulation is never allowed in production, whatever the flag says.
    ALLOW_DEMO_LOCATION: prod ? false : (e.ALLOW_DEMO_LOCATION ?? true),
    JOBS_ENABLED: e.JOBS_ENABLED ?? e.NODE_ENV !== 'test',
  };
}

export const env = load();
export const isProd = env.NODE_ENV === 'production';
