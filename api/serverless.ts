// Vercel serverless entry for the Express REST API.
//
// The long-lived process entry (app.listen) lives in apps/server/src/server.ts
// and is intentionally NOT used here: a serverless function handles one
// request per invocation.
//
// Scope note (plan.md section 24): this serves the REST API only
// (health, auth, pairing, command history). The persistent WSS relay the PC
// agent needs cannot run on serverless functions (execution timeouts kill
// long-lived sockets) — host the relay on a container/VM per plan.md.
import express, { type Request, type Response } from 'express';
import { createApp } from '../apps/server/src/app.js';

let app: express.Express;

try {
  const serverApp = createApp();
  const serverlessApp = express();
  // If Vercel rewrote the URL to the destination handler path (/api/index.js),
  // restore the original requested path from x-matched-path so Express routes match.
  serverlessApp.use((req, _res, next) => {
    if (req.url === '/api/index.js' || req.url.startsWith('/api/index.js?')) {
      const original = req.headers['x-matched-path'];
      if (typeof original === 'string' && original.startsWith('/')) {
        req.url = original;
      }
    }
    next();
  });
  serverlessApp.use(serverApp);
  app = serverlessApp;
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

export default app;
