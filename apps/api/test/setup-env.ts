import crypto from 'node:crypto';
import { inject } from 'vitest';

// Runs before each test file's imports, so config/env.ts sees these values.
const base = inject('mongoUri');
const db = `tadka_test_${crypto.randomBytes(4).toString('hex')}`;
process.env.MONGODB_URI = base.replace(/\/(\?|$)/, `/${db}$1`);
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.SMS_PROVIDER = 'mock';
process.env.JOBS_ENABLED = 'false';
process.env.ALLOW_DEMO_LOCATION = 'true';
process.env.WEB_ORIGIN = 'http://localhost:5173';
