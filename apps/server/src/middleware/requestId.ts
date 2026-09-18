import type { NextFunction, Request, Response } from 'express';
import { newRequestId } from '../lib/ids.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/** Assigns a stable requestId per request (propagated in logs + error shape). */
export function requestId(req: Request, _res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId =
    typeof incoming === 'string' && incoming.length >= 1 && incoming.length <= 100
      ? incoming
      : newRequestId();
  next();
}
