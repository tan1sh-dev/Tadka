import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { InvalidTransitionError } from '@tadka/shared';
import { logger } from './logger';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Please log in to continue') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);

/** Validates input with a zod schema and throws a 400 with field errors on failure. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', r.error.flatten());
  return r.data;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => next(notFound(`Route ${req.method} ${req.path}`));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let e: AppError;
  if (err instanceof AppError) e = err;
  else if (err instanceof ZodError) e = new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', err.flatten());
  else if (err instanceof InvalidTransitionError) e = new AppError(409, 'INVALID_TRANSITION', err.message);
  else if (err instanceof mongoose.Error.CastError) e = badRequest('Invalid identifier');
  else if (err?.type === 'entity.parse.failed') e = badRequest('Malformed JSON body');
  else if (err?.type === 'entity.too.large') e = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  else if (err?.code === 11000) e = conflict('DUPLICATE', 'A record with these details already exists');
  else {
    logger.error({ err, reqId: req.id }, 'Unhandled error');
    e = new AppError(500, 'INTERNAL', 'Something went wrong on our side. Please try again.');
  }
  if (e.status >= 500 && err instanceof AppError) logger.error({ err, reqId: req.id }, e.message);
  res.status(e.status).json({ error: { code: e.code, message: e.message, details: e.details, requestId: req.id } });
};
