import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmetDefault from 'helmet';
import { pinoHttp } from 'pino-http';
import { corsOrigins, env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { requestId } from './middleware/requestId.js';
import { healthRouter } from './routes/health.js';

// helmet@8 ships dual CJS/ESM type definitions (index.d.cts + index.d.mts)
// with no "types" condition in "exports". Some resolvers (observed on the
// Vercel Linux build) pick the CJS definitions, where the default import
// types as the non-callable exports namespace instead of the middleware
// factory. Normalize through unknown so this compiles under either
// resolution. At runtime Node always loads index.mjs, whose default export
// is the factory (verified by tests + live boot).
const helmet = helmetDefault as unknown as (
  options?: Record<string, unknown>,
) => express.RequestHandler;

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({ requestId: (req as unknown as { requestId: string }).requestId }),
      // Redact auth headers at the HTTP layer too.
      redact: ['req.headers.authorization'],
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins(),
      credentials: false,
      maxAge: 600,
    }),
  );
  // Body limits: fail closed before protocol validation (64KB command cap enforced in @orbit/protocol).
  app.use(express.json({ limit: '256kb', strict: true }));

  // Vercel serverless rewrite normalization: restore original path if rewritten to entrypoint
  app.use((req, _res, next) => {
    if (req.url === '/api/index.js' || req.url.startsWith('/api/index.js?')) {
      const original = req.headers['x-matched-path'];
      if (typeof original === 'string' && original.startsWith('/')) {
        req.url = original;
      }
    }
    next();
  });

  // Root endpoint for status / platform liveness
  app.get('/', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'orbit-server',
      version: '0.1.0',
    });
  });

  // Unversioned liveness (load balancers) + versioned API health.
  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use('/v1', healthRouter);

  app.use(notFound);
  app.use(errorHandler);

  void env;
  return app;
}

const defaultApp = createApp();
export default defaultApp;
