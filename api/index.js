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
import express from 'express';
import { createApp } from '../apps/server/dist/app.js';

let app;

try {
  app = createApp();
} catch (err) {
  console.error('Failed to initialize Orbit server app:', err);
  const fallback = express();
  fallback.all('*', (_req, res) => {
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
