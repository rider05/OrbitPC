import 'dotenv/config';
import { createServer } from 'node:http';
import app, { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { attachRealtime } from './realtime/index.js';

let server: ReturnType<typeof createServer> | undefined;

if (!process.env.VERCEL) {
  server = createServer(app);
  attachRealtime(server);
  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'orbit-server listening');
  });

  function shutdown(signal: string): void {
    logger.info({ signal }, 'shutting down');
    server?.close((err) => {
      if (err) {
        logger.error({ err }, 'error during shutdown');
        process.exitCode = 1;
        return;
      }
      process.exitCode = 0;
    });
    // Force-exit if connections linger (bounded shutdown).
    setTimeout(() => {
      logger.warn('forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export default app;
