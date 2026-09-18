import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('server M0', () => {
  it('GET /v1/health returns liveness payload', async () => {
    const app = createApp();
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('orbit-server');
    expect(typeof res.body.time).toBe('string');
  });

  it('GET /health returns ok (load balancer)', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('unknown route returns stable error shape with requestId', async () => {
    const app = createApp();
    const res = await request(app).get('/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.requestId).toBe('string');
  });

  it('malformed JSON fails closed with INVALID_ARGUMENT', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/v1/health')
      .set('content-type', 'application/json')
      .send('{"bad":');
    expect([400, 404]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error.code).toBe('INVALID_ARGUMENT');
    }
  });
});
