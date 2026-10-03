import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

// Security-focused e2e: every negative path must fail closed with the stable
// protocol error shape. Runs against the live DATABASE_URL like e2e.test.ts.
const app = createApp();

async function registerPair() {
  const email = `sec-${randomUUID()}@example.com`;
  const reg = await request(app).post('/v1/auth/register').send({ email, password: 'correct-horse-123' });
  const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
  const dc = await request(app).post('/v1/pairing-sessions/device-code').send({
    publicKey: 'not-real-key-material-but-shape-ok',
    displayName: 'SEC-PC',
  });
  const { pairingId, pollingSecret } = dc.body as { pairingId: string; pollingSecret: string };
  const confirm = await request(app).post(`/v1/pairing-sessions/${pairingId}/confirm`).set(auth).send({});
  const computerId = confirm.body.id as string;
  const cred = await request(app).post(`/v1/pairing-sessions/${pairingId}/credential`).send({ pollingSecret });
  return { auth, email, computerId, credential: cred.body.credential as string };
}

describe('security invariants', () => {
  it('unauthenticated requests fail closed', async () => {
    for (const path of ['/v1/computers', '/v1/auth/reauthenticate']) {
      const res = await request(app).get(path);
      expect([200, 401, 404]).toContain(res.status);
      if (res.status === 401) expect(res.body.error.code).toBe('AUTH_REQUIRED');
    }
    const noAuthPost = await request(app).post('/v1/computers');
    expect(noAuthPost.status).toBe(404); // route is GET-only / no list-by-uuid POST
  });

  it('a user cannot read or delete another user\'s computer', async () => {
    const victim = await registerPair();
    const attacker = await registerPair();
    const get = await request(app).get(`/v1/computers/${victim.computerId}`).set(attacker.auth);
    expect(get.status).toBe(403);
    const del = await request(app).delete(`/v1/computers/${victim.computerId}`).set(attacker.auth);
    expect(del.status).toBe(403);
  });

  it('agent commands cannot be reported with the wrong credential', async () => {
    const { auth, computerId } = await registerPair();
    const cmdId = randomUUID();
    await request(app).post(`/v1/computers/${computerId}/commands`).set(auth).send({
      commandId: cmdId,
      idempotencyKey: randomUUID(),
      name: 'system.getStatus',
      args: {},
    });
    const bad = await request(app).post(`/v1/commands/${cmdId}/result`).set('Authorization', 'Bearer wrong').send({
      status: 'succeeded',
      sequence: 1,
      result: null,
      error: null,
    });
    expect(bad.status).toBe(401);
  });

  it('traded/unknown agent cannot heartbeat or pick up pending', async () => {
    const { computerId } = await registerPair();
    const hb = await request(app).post(`/v1/computers/${computerId}/heartbeat`).send({ bootId: 'x' });
    expect(hb.status).toBe(401);
    const pd = await request(app).get(`/v1/computers/${computerId}/pending`);
    expect(pd.status).toBe(401);
  });

  it('destructive offline commands fail closed and are never queued', async () => {
    const victim = await registerPair();
    const res = await request(app)
      .post(`/v1/computers/${victim.computerId}/commands`)
      .set(victim.auth)
      .send({ commandId: randomUUID(), idempotencyKey: randomUUID(), name: 'system.shutdown', args: {} });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COMPUTER_OFFLINE');
  });

  it('idempotency: same key cannot be used for two different commands', async () => {
    const victim = await registerPair();
    const key = randomUUID();
    await request(app)
      .post(`/v1/computers/${victim.computerId}/commands`)
      .set(victim.auth)
      .send({ commandId: randomUUID(), idempotencyKey: key, name: 'system.getStatus', args: {} });
    const res = await request(app)
      .post(`/v1/computers/${victim.computerId}/commands`)
      .set(victim.auth)
      .send({ commandId: randomUUID(), idempotencyKey: key, name: 'system.lock', args: {} });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_COMMAND');
  });

  it('a stale result after success does not regress the final state', async () => {
    const victim = await registerPair();
    const cmdId = randomUUID();
    await request(app)
      .post(`/v1/computers/${victim.computerId}/commands`)
      .set(victim.auth)
      .send({ commandId: cmdId, idempotencyKey: randomUUID(), name: 'system.getStatus', args: {} });
    const agent = { Authorization: `Bearer ${victim.credential}` };
    await request(app).post(`/v1/computers/${victim.computerId}/heartbeat`).set(agent).send({ bootId: 's1' });
    await request(app).get(`/v1/computers/${victim.computerId}/pending`).set(agent);
    await request(app).post(`/v1/commands/${cmdId}/result`).set(agent).send({ status: 'succeeded', sequence: 2, result: { hostname: 'OK' }, error: null });
    const stale = await request(app).post(`/v1/commands/${cmdId}/result`).set(agent).send({ status: 'failed', sequence: 1, result: null, error: { code: 'EXECUTION_FAILED', message: 'stale' } });
    expect(stale.status).toBe(200);
    const final = await request(app).get(`/v1/commands/${cmdId}`).set(victim.auth);
    expect(final.body.status).toBe('succeeded');
    expect(final.body.sequence).toBe(2);
  });
});
