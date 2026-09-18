import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const app = createApp();
const password = 'correct-horse-123';

async function register() {
  const email = `e2e-${randomUUID()}@example.com`;
  const res = await request(app).post('/v1/auth/register').send({ email, password });
  expect(res.status).toBe(201);
  return { ...(res.body as { accessToken: string; refreshToken: string; sessionId: string }), email };
}

describe('auth + pairing + poll-relay commands (real E2E)', () => {
  it('register -> login -> refresh rotates -> logout revokes', async () => {
    const reg = await register();
    expect(reg.accessToken).toBeTruthy();

    const login = await request(app).post('/v1/auth/login').send({ email: reg.email, password });
    expect(login.status).toBe(200);

    const bad = await request(app).post('/v1/auth/login').send({ email: reg.email, password: 'wrong-pass-1' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('AUTH_REQUIRED');

    const rot = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken, sessionId: login.body.sessionId });
    expect(rot.status).toBe(200);
    expect(rot.body.refreshToken).not.toBe(login.body.refreshToken);

    // Old refresh token is dead after rotation.
    const stale = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken, sessionId: login.body.sessionId });
    expect(stale.status).toBe(401);

    const out = await request(app).post('/v1/auth/logout').send({ sessionId: rot.body.sessionId });
    expect(out.status).toBe(200);
    const afterLogout = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: rot.body.refreshToken, sessionId: rot.body.sessionId });
    expect(afterLogout.status).toBe(401);

    // Re-auth proof works with the password.
    const re = await request(app)
      .post('/v1/auth/reauthenticate')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ password });
    expect(re.status).toBe(200);
  });

  it('device-code -> preview -> confirm -> status -> credential (rotates)', async () => {
    const reg = await register();
    const auth = { Authorization: `Bearer ${reg.accessToken}` };

    const dc = await request(app)
      .post('/v1/pairing-sessions/device-code')
      .send({ publicKey: 'test-public-key-material', displayName: 'TEST-PC' });
    expect(dc.status).toBe(201);
    const { pairingId, userCode, pollingSecret } = dc.body as {
      pairingId: string;
      userCode: string;
      pollingSecret: string;
    };

    const preview = await request(app).get('/v1/pairing-sessions/preview').query({ code: userCode }).set(auth);
    expect(preview.status).toBe(200);
    expect(preview.body.pairingId).toBe(pairingId);
    expect(preview.body.computerName).toBe('TEST-PC');
    expect(preview.body.accountEmail).toBe(reg.email);

    // QR scans yield the pairingId — preview accepts that too.
    const previewById = await request(app).get('/v1/pairing-sessions/preview').query({ code: pairingId }).set(auth);
    expect(previewById.status).toBe(200);
    expect(previewById.body.pairingId).toBe(pairingId);

    const pending = await request(app)
      .get(`/v1/pairing-sessions/${pairingId}/status`)
      .set('Authorization', `Bearer ${pollingSecret}`);
    expect(pending.status).toBe(404);

    const confirm = await request(app).post(`/v1/pairing-sessions/${pairingId}/confirm`).set(auth).send({});
    expect(confirm.status).toBe(201);
    const computerId = confirm.body.id as string;

    const approved = await request(app)
      .get(`/v1/pairing-sessions/${pairingId}/status`)
      .set('Authorization', `Bearer ${pollingSecret}`);
    expect(approved.status).toBe(200);
    expect(approved.body.computerId).toBe(computerId);

    const cred1 = await request(app)
      .post(`/v1/pairing-sessions/${pairingId}/credential`)
      .send({ pollingSecret });
    expect(cred1.status).toBe(201);
    // Rotation: second issue revokes the first.
    const cred2 = await request(app)
      .post(`/v1/pairing-sessions/${pairingId}/credential`)
      .send({ pollingSecret });
    expect(cred2.status).toBe(201);
    expect(cred2.body.credential).not.toBe(cred1.body.credential);

    // Old credential no longer authenticates the agent.
    const dead = await request(app)
      .post(`/v1/computers/${computerId}/heartbeat`)
      .set('Authorization', `Bearer ${cred1.body.credential}`)
      .send({ bootId: 'b1' });
    expect(dead.status).toBe(401);

    // Re-confirm of a used session fails closed.
    const again = await request(app).post(`/v1/pairing-sessions/${pairingId}/confirm`).set(auth).send({});
    expect(again.status).toBe(409);

    // Full command round trip over the poll relay.
    const agentAuth = { Authorization: `Bearer ${cred2.body.credential}` };
    const hb = await request(app).post(`/v1/computers/${computerId}/heartbeat`).set(agentAuth).send({ bootId: 'b1' });
    expect(hb.status).toBe(200);

    const cmdId = randomUUID();
    const sub = await request(app)
      .post(`/v1/computers/${computerId}/commands`)
      .set(auth)
      .send({ commandId: cmdId, idempotencyKey: randomUUID(), name: 'system.getStatus', args: {} });
    expect(sub.status).toBe(201);
    expect(sub.body.status).toBe('queued');

    // Same idempotency key returns the original record.
    const sub2 = await request(app)
      .post(`/v1/computers/${computerId}/commands`)
      .set(auth)
      .send({ commandId: randomUUID(), idempotencyKey: sub.body.idempotencyKey, name: 'system.getStatus', args: {} });
    expect(sub2.status).toBe(200);
    expect(sub2.body.id).toBe(cmdId);

    const pend = await request(app).get(`/v1/computers/${computerId}/pending`).set(agentAuth);
    expect(pend.status).toBe(200);
    expect(pend.body.commands).toHaveLength(1);
    expect(pend.body.commands[0].commandId).toBe(cmdId);
    expect(pend.body.commands[0].type).toBe('command.request');

    for (const [seq, status] of [[1, 'acknowledged'], [2, 'running'], [3, 'succeeded']] as const) {
      const r = await request(app).post(`/v1/commands/${cmdId}/result`).set(agentAuth).send({
        status,
        sequence: seq,
        result: status === 'succeeded' ? { hostname: 'TEST-PC' } : null,
        error: null,
      });
      expect(r.status).toBe(200);
    }
    const final = await request(app).get(`/v1/commands/${cmdId}`).set(auth);
    expect(final.body.status).toBe('succeeded');
    expect(final.body.sequence).toBe(3);
    expect(final.body.resultRedacted).toEqual({ hostname: 'TEST-PC' });

    // Stale sequence is ignored; terminal state is sticky.
    const stale = await request(app).post(`/v1/commands/${cmdId}/result`).set(agentAuth).send({
      status: 'failed',
      sequence: 1,
      result: null,
      error: { code: 'EXECUTION_FAILED', message: 'x' },
    });
    expect(stale.body.status).toBe('succeeded');

    // Destructive needs a fresh password proof: blocked before, allowed after.
    const noReauth = await request(app)
      .post(`/v1/computers/${computerId}/commands`)
      .set(auth)
      .send({ commandId: randomUUID(), idempotencyKey: randomUUID(), name: 'system.restart', args: {} });
    expect(noReauth.status).toBe(401);
    const reauth = await request(app).post('/v1/auth/reauthenticate').set(auth).send({ password });
    expect(reauth.status).toBe(200);
    const off = await request(app)
      .post(`/v1/computers/${computerId}/commands`)
      .set(auth)
      .send({ commandId: randomUUID(), idempotencyKey: randomUUID(), name: 'system.restart', args: {} });
    // Agent heartbeated above (online), so this queues.
    expect(off.status).toBe(201);

    // Notification + clipboard arg shapes validate server-side.
    const notif = await request(app)
      .post(`/v1/computers/${computerId}/commands`)
      .set(auth)
      .send({ commandId: randomUUID(), idempotencyKey: randomUUID(), name: 'notification.show', args: { title: 't', body: 'hi' } });
    expect(notif.status).toBe(201);
    const badNotif = await request(app)
      .post(`/v1/computers/${computerId}/commands`)
      .set(auth)
      .send({ commandId: randomUUID(), idempotencyKey: randomUUID(), name: 'notification.show', args: { text: 'hi' } });
    expect(badNotif.status).toBe(400);
  });

  it('computers CRUD + revoke closes agent access', async () => {    const reg = await register();
    const auth = { Authorization: `Bearer ${reg.accessToken}` };
    const dc = await request(app)
      .post('/v1/pairing-sessions/device-code')
      .send({ publicKey: 'test-public-key-material', displayName: 'REVOKE-PC' });
    const confirm = await request(app).post(`/v1/pairing-sessions/${dc.body.pairingId}/confirm`).set(auth).send({});
    const computerId = confirm.body.id as string;
    const cred = await request(app)
      .post(`/v1/pairing-sessions/${dc.body.pairingId}/credential`)
      .send({ pollingSecret: dc.body.pollingSecret });

    const renamed = await request(app).patch(`/v1/computers/${computerId}`).set(auth).send({ displayName: 'NEW-NAME' });
    expect(renamed.body.displayName).toBe('NEW-NAME');

    const del = await request(app).delete(`/v1/computers/${computerId}`).set(auth);
    expect(del.status).toBe(200);
    const gone = await request(app).get(`/v1/computers/${computerId}`).set(auth);
    expect(gone.status).toBe(404);

    const hb = await request(app)
      .post(`/v1/computers/${computerId}/heartbeat`)
      .set('Authorization', `Bearer ${cred.body.credential}`)
      .send({ bootId: 'b' });
    expect(hb.status).toBe(401);
  });
});
