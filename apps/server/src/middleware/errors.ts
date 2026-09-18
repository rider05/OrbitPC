import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** 404 for unknown routes — stable error shape. */
export function notFound(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.path}.`,
      requestId: req.requestId,
    },
  });
}

/** Centralized error handler — never leaks stack/secrets to clients. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, requestId: req.requestId },
    });
    return;
  }
  // Schema validation failures are client errors, never 500s.
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: { code: 'INVALID_ARGUMENT', message: 'Invalid request.', requestId: req.requestId },
    });
    return;
  }
  // express.json() body-parse errors carry status + body props.
  const maybeStatus =
    typeof err === 'object' && err !== null && 'status' in err
      ? (err as { status?: unknown }).status
      : undefined;
  if (typeof maybeStatus === 'number' && maybeStatus >= 400 && maybeStatus < 500) {
    res.status(maybeStatus).json({
      error: {
        code: 'INVALID_ARGUMENT',
        message: 'Malformed JSON body.',
        requestId: req.requestId,
      },
    });
    return;
  }
  logger.error({ err, requestId: req.requestId, path: req.path }, 'unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Internal error.', requestId: req.requestId },
  });
}
