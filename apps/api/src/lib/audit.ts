import type { Request } from 'express';
import type { ClientSession } from 'mongoose';
import { AuditLogModel } from '../models/ops';

export async function audit(
  req: Request,
  action: string,
  targetType: string,
  targetId: string,
  changes: Record<string, unknown> | null = null,
  session?: ClientSession,
): Promise<void> {
  await AuditLogModel.create(
    [
      {
        actorId: req.user?.id ?? null,
        actorRole: req.user?.role ?? 'system',
        action,
        targetType,
        targetId,
        changes,
        ip: req.ip ?? '',
      },
    ],
    { session },
  );
}
