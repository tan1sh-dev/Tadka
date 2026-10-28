import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isProd } from './config/env';
import { dbHealthy } from './lib/db';
import { errorHandler, notFoundHandler } from './lib/errors';
import { logger } from './lib/logger';
import { authenticate, csrfProtection } from './middleware/auth';
import { apiLimiter, rejectOperatorKeys } from './middleware/security';
import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { deliveryRouter } from './modules/delivery/delivery.routes';
import { merchantRouter } from './modules/merchant/merchant.routes';
import { twilioCallbackRouter } from './modules/notifications/notifications.routes';
import { cartsRouter, ordersRouter } from './modules/orders/orders.routes';
import { paymentsInfo, paymentsRouter, webhookRouter } from './modules/payments/payments.routes';
import { restaurantsRouter, serviceabilityRouter } from './modules/restaurants/restaurants.routes';
import { addressesRouter, usersRouter } from './modules/users/users.routes';
import { promotionsRouter } from './modules/promotions/promotions.routes';
import { geocode, mapsConfigured } from './services/geo';
import { getSmsProvider } from './modules/notifications/sms.provider';

export function createApp() {
  const app = express();
  if (isProd) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: env.NODE_ENV !== 'test',
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://maps.googleapis.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'https://maps.googleapis.com', 'wss:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        },
      },
    }),
  );
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(cookieParser());

  // Raw/urlencoded bodies + signature auth: must be mounted before JSON parsing and CSRF.
  app.use('/api/v1/payments/webhook', webhookRouter);
  app.use('/api/v1/notifications', twilioCallbackRouter);

  app.use(express.json({ limit: '100kb' }));
  app.use(rejectOperatorKeys);

  const api = Router();
  api.use(apiLimiter);
  api.use(authenticate);
  api.use(csrfProtection);

  api.get('/health', (_req, res) => {
    const ok = dbHealthy();
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', db: ok ? 'up' : 'down', uptimeSec: Math.round(process.uptime()) });
  });
  api.get('/meta', (_req, res) => {
    res.json({
      payments: paymentsInfo(),
      sms: { provider: getSmsProvider().name },
      maps: { server: mapsConfigured() },
      demoLocationAllowed: env.ALLOW_DEMO_LOCATION,
    });
  });
  api.post('/geo/geocode', async (req, res) => {
    const q = typeof req.body?.address === 'string' ? req.body.address.slice(0, 200) : '';
    if (!mapsConfigured()) return res.status(503).json({ error: { code: 'MAPS_NOT_CONFIGURED', message: 'Address lookup is not configured.' } });
    const r = q ? await geocode(q) : null;
    if (!r) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'We could not find that address.' } });
    res.json(r);
  });

  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/addresses', addressesRouter);
  api.use('/serviceability', serviceabilityRouter);
  api.use('/restaurants', restaurantsRouter);
  api.use('/carts', cartsRouter);
  api.use('/orders', ordersRouter);
  api.use('/payments', paymentsRouter);
  api.use('/promotions', promotionsRouter);
  api.use('/merchant', merchantRouter);
  api.use('/delivery', deliveryRouter);
  api.use('/admin', adminRouter);
  api.use(notFoundHandler);

  app.use('/api/v1', api);

  // Single-origin production deployment: serve the built SPA from the API.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (isProd && fs.existsSync(webDist)) {
    app.use(express.static(webDist, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
