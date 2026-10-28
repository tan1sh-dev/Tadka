import express, { Router } from 'express';
import twilio from 'twilio';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { NotificationModel } from '../../models/ops';

/** Twilio delivery-status callbacks. Mounted before CSRF; authenticated by Twilio's request signature. */
export const twilioCallbackRouter = Router();

twilioCallbackRouter.post('/twilio/status', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
  if (env.SMS_PROVIDER !== 'twilio' || !env.TWILIO_AUTH_TOKEN) throw new AppError(404, 'NOT_FOUND', 'Not enabled');
  const signature = req.get('x-twilio-signature') ?? '';
  const url = `${env.APP_BASE_URL}/api/v1/notifications/twilio/status`;
  if (!twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, req.body))
    throw new AppError(403, 'BAD_SIGNATURE', 'Invalid signature');
  const { MessageSid, MessageStatus, ErrorCode } = req.body as Record<string, string>;
  const map: Record<string, string> = { delivered: 'DELIVERED', undelivered: 'UNDELIVERED', failed: 'FAILED', sent: 'SENT' };
  const status = map[MessageStatus];
  if (status) {
    await NotificationModel.updateOne(
      { providerMessageId: MessageSid },
      { $set: { status, ...(ErrorCode ? { lastError: `Twilio error ${ErrorCode}` } : {}) } },
    );
  }
  res.status(204).end();
});
