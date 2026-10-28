import pino from 'pino';
import { env } from '../config/env';

/** Paths that must never reach logs: credentials, tokens, contact details, precise locations. */
const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["stripe-signature"]',
  'req.headers["x-twilio-signature"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.phone',
  '*.to',
  '*.email',
  '*.token',
  '*.secret',
  '*.lat',
  '*.lng',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT, censor: '[redacted]' },
  ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
});

export function maskPhone(phone: string | undefined | null): string {
  if (!phone) return '';
  return phone.length > 4 ? `${'•'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : '••••';
}
