// Vercel serverless entry for the Express REST API.
//
// The long-lived process entry (app.listen) lives in apps/server/src/server.ts
// and is intentionally NOT used here: a serverless function handles one
// request per invocation. Import from TypeScript source so the function has no
// dependency on a committed dist/ directory (dist/ is gitignored).
//
// Scope note (plan.md section 24): this serves the REST API only
// (health, auth, pairing, command history). The persistent WSS relay the PC
// agent needs cannot run on serverless functions (execution timeouts kill
// long-lived sockets) — host the relay on a container/VM per plan.md.
import type { Request, Response } from 'express';
import { createApp } from '../apps/server/src/app.js';

const app = createApp();

export default function handler(req: Request, res: Response): void {
  app(req, res);
}
