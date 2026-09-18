import { Router, type Request, type Response } from 'express';

export const healthRouter: Router = Router();

/**
 * M0 health check — unauthenticated liveness.
 * Authenticated readiness / DB checks land with M1 (presence + Prisma).
 */
healthRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: 'orbit-server',
    version: '0.1.0',
    time: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
  });
});
