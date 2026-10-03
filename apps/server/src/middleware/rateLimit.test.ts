import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit.js';
import { errorHandler } from './errors.js';

describe('createRateLimiter', () => {
  it('allows up to max requests per window, then 429s', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, max: 2, scope: 'test' }));
    app.get('/x', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(200);
    const third = await request(app).get('/x');
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });

  it('separate scopes do not share counters', async () => {
    const app = express();
    app.use('/a', createRateLimiter({ windowMs: 60_000, max: 1, scope: 'a' }));
    app.use('/b', createRateLimiter({ windowMs: 60_000, max: 1, scope: 'b' }));
    app.get('/a', (_req, res) => res.json({ ok: true }));
    app.get('/b', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    expect((await request(app).get('/a')).status).toBe(200);
    expect((await request(app).get('/b')).status).toBe(200);
    expect((await request(app).get('/a')).status).toBe(429);
    expect((await request(app).get('/b')).status).toBe(429);
  });
});
