import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDb, disconnectDb } from './lib/db';
import { logger } from './lib/logger';
import { startJobs, stopJobs } from './jobs';
import { attachSocketServer } from './realtime/socket';

async function main() {
  await connectDb();
  const app = createApp();
  const server = http.createServer(app);
  const io = attachSocketServer(server);
  server.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, payments: env.PAYMENT_PROVIDER, sms: env.SMS_PROVIDER, maps: Boolean(env.GOOGLE_MAPS_SERVER_KEY) },
      `Tadka API listening on http://localhost:${env.PORT}`,
    );
  });
  startJobs();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    stopJobs();
    io.close();
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
