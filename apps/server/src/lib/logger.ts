import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Structured JSON logs per docs/runbook.md.
 * NEVER log tokens, credentials, pairing secrets, clipboard contents,
 * or full sensitive paths — callers must redact before logging.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'orbit-server' },
  redact: {
    paths: [
      'req.headers.authorization',
      '*.password',
      '*.password_hash',
      '*.refreshToken',
      '*.refresh_token_hash',
      '*.credential',
      '*.secret',
      '*.pairingSecret',
      '*.clipboard',
      '*.text',
    ],
    censor: '[REDACTED]',
  },
});
