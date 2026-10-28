import twilio from 'twilio';
import { env } from '../../config/env';

export interface SmsResult {
  providerMessageId: string;
  status: 'sent' | 'queued';
}

export interface SmsProvider {
  readonly name: 'mock' | 'twilio';
  send(to: string, body: string): Promise<SmsResult>;
}

/**
 * Development/test provider. Nothing leaves the machine; the Notification record is the "sent" message.
 * Numbers ending in 0000 fail deterministically so failure handling can be exercised.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock' as const;
  async send(to: string, _body: string): Promise<SmsResult> {
    if (to.endsWith('0000')) throw new Error('Mock carrier rejected the destination number');
    return { providerMessageId: `mock_sms_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, status: 'sent' };
  }
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio' as const;
  private client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, { timeout: 8000 });

  async send(to: string, body: string): Promise<SmsResult> {
    const msg = await this.client.messages.create({
      to,
      body,
      ...(env.TWILIO_MESSAGING_SERVICE_SID
        ? { messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID }
        : { from: env.TWILIO_FROM_NUMBER }),
      statusCallback: `${env.APP_BASE_URL}/api/v1/notifications/twilio/status`,
    });
    return { providerMessageId: msg.sid, status: 'queued' };
  }
}

let provider: SmsProvider | null = null;
export function getSmsProvider(): SmsProvider {
  provider ??= env.SMS_PROVIDER === 'twilio' ? new TwilioSmsProvider() : new MockSmsProvider();
  return provider;
}
export function setSmsProvider(p: SmsProvider | null) {
  provider = p;
}
