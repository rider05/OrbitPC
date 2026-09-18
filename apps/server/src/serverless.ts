// Vercel serverless entry for the Express REST API.
//
// The long-lived process entry (app.listen) lives in ./server.js
// and is intentionally NOT used here: a serverless function handles one
// request per invocation.
//
// Scope note (plan.md section 24): this serves the REST API only
// (health, auth, pairing, command history). The persistent WSS relay the PC
// agent needs cannot run on serverless functions (execution timeouts kill
// long-lived sockets) — host the relay on a container/VM per plan.md.
//
// Build (root package.json `build:api`) bundles this to api/index.js as CJS
// (api/package.json pins type: commonjs). api/ must contain ONLY the
// generated bundle: Vercel turns every file in api/ into a function, so a
// second source file there becomes a second (shadow) function.
import express, { type Request, type Response } from 'express';
import { createApp } from './app.js';

let app: express.Express;

try {
  app = createApp();
} catch (err) {
  console.error('Failed to initialize Orbit server app:', err);
  const fallback = express();
  fallback.all('*', (_req: Request, res: Response) => {
    res.status(500).json({
      error: {
        code: 'INITIALIZATION_FAILED',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  });
  app = fallback;
}

export default function handler(req: Request, res: Response): unknown {
  try {
    return app(req, res);
  } catch (err) {
    console.error('Unhandled invocation error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          code: 'INTERNAL',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}
