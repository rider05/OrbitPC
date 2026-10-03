import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import WebSocket from 'ws';
import { io as sioClient, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from './app.js';
import { attachRealtime } from './realtime/index.js';

// Full realtime relay E2E (requires DATABASE_URL like e2e.test.ts):
// agent WSS auth + pending replay + command.result persistence + mobile hint.

let server: HttpServer;
let base: string;
let wsBase: string;

beforeAll(async () => {
  server = createServer(app);
  attachRealtime(server);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});

async function pairComputer() {
  const email = `rt-${randomUUID()}@example.com`;
  const reg = await request(base).post('/v1/auth/register').send({ email, password: 'correct-horse-123' });
  const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
  // Real Ed25519 identity: registered at pairing, proof-of-possession required on WSS upgrade.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const dc = await request(base)
    .post('/v1/pairing-sessions/device-code')
    .send({ publicKey: publicKeyPem, displayName: 'RT-PC' });
  const { pairingId, pollingSecret } = dc.body as { pairingId: string; pollingSecret: string };
  const confirm = await request(base).post(`/v1/pairing-sessions/${pairingId}/confirm`).set(auth).send({});
  const computerId = confirm.body.id as string;
  const cred = await request(base).post(`/v1/pairing-sessions/${pairingId}/credential`).send({ pollingSecret });
  return {
    auth,
    accessToken: reg.body.accessToken as string,
    computerId,
    credential: cred.body.credential as string,
    privateKeyPem,
  };
}

/** WSS auth headers: bearer device credential + Ed25519 nonce proof (plan.md §8). */
function agentHeaders(credential: string, privateKeyPem: string): Record<string, string> {
  const nonce = Buffer.from(randomUUID().replace(/-/g, ''), 'hex'); // 16 bytes — pad to 32
  const nonce32 = Buffer.concat([nonce, nonce]);
  const proof = sign(null, nonce32, { key: privateKeyPem });
  return {
    authorization: `Bearer ${credential}`,
    'x-nonce': nonce32.toString('base64'),
    'x-nonce-proof': proof.toString('base64'),
  };
}

describe('realtime relay', () => {
  it('agent WSS auth, pending push, result persistence, mobile hint, revoke', async () => {
    const { auth, accessToken, computerId, credential, privateKeyPem } = await pairComputer();

    // Fail closed: bad credential cannot open the agent socket.
    const denied = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${wsBase}/agent?computerId=${computerId}`, {
        headers: { authorization: 'Bearer wrong-credential' },
      });
      ws.on('open', () => {
        ws.close();
        resolve(200);
      });
      ws.on('error', (err) => resolve(String(err).includes('401') ? 401 : 500));
    });
    expect(denied).toBe(401);

    // Fail closed: real credential but no nonce proof (computer registered a key).
    const noProof = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${wsBase}/agent?computerId=${computerId}`, {
        headers: { authorization: `Bearer ${credential}` },
      });
      ws.on('open', () => {
        ws.close();
        resolve(200);
      });
      ws.on('error', (err) => resolve(String(err).includes('401') ? 401 : 500));
    });
    expect(noProof).toBe(401);

    // Mobile connects to the /socket namespace with the JWT.
    const mobile: ClientSocket = sioClient(`${base}/socket`, {
      auth: { token: accessToken },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve, reject) => {
      mobile.on('connect', resolve);
      mobile.on('connect_error', reject);
    });

    const hint = new Promise<{ commandId: string }>((resolve) => {
      mobile.on('command.result', (msg: { commandId: string }) => resolve(msg));
    });

    // Agent connects with the real device credential + Ed25519 proof.
    const agent = new WebSocket(`${wsBase}/agent?computerId=${computerId}`, {
      headers: agentHeaders(credential, privateKeyPem),
    });
    await new Promise<void>((resolve, reject) => {
      agent.on('open', resolve);
      agent.on('error', reject);
    });

    // Server pushes a new command to the live agent socket (low-latency path).
    const push = new Promise<{ type: string; commandId: string; name: string }>((resolve) => {
      agent.on('message', (data) => {
        const msg = JSON.parse(String(data)) as { type?: string; commandId?: string; name?: string };
        if (msg.type === 'command.request') resolve(msg as { type: string; commandId: string; name: string });
      });
    });
    const cmdId = randomUUID();
    const sub = await request(base)
      .post(`/v1/computers/${computerId}/commands`)
      .set(auth)
      .send({ commandId: cmdId, idempotencyKey: randomUUID(), name: 'system.getStatus', args: {} });
    expect(sub.status).toBe(201);
    const pushed = await push;
    expect(pushed.commandId).toBe(cmdId);
    expect(pushed.name).toBe('system.getStatus');

    // Agent reports the result over WSS: persisted + hinted to mobile.
    agent.send(
      JSON.stringify({ type: 'command.result', commandId: cmdId, status: 'succeeded', sequence: 1, result: { hostname: 'RT-PC' }, error: null }),
    );
    const gotHint = await hint;
    expect(gotHint.commandId).toBe(cmdId);
    const final = await request(base).get(`/v1/commands/${cmdId}`).set(auth);
    expect(final.body.status).toBe('succeeded');
    expect(final.body.sequence).toBe(1);

    // Heartbeat over WSS updates presence.
    agent.send(JSON.stringify({ type: 'presence.heartbeat', bootId: 'boot-1' }));
    await new Promise<void>((resolve) => {
      agent.on('message', (data) => {
        const msg = JSON.parse(String(data)) as { type?: string };
        if (msg.type === 'pong') resolve();
      });
    });
    const comp = await request(base).get(`/v1/computers/${computerId}`).set(auth);
    expect(comp.body.status).toBe('online');
    expect(comp.body.bootId).toBe('boot-1');

    // Revocation drops the agent socket immediately.
    const revoked = new Promise<void>((resolve) => {
      agent.on('message', (data) => {
        const msg = JSON.parse(String(data)) as { type?: string };
        if (msg.type === 'revoked') resolve();
      });
    });
    await request(base).delete(`/v1/computers/${computerId}`).set(auth);
    await revoked;

    mobile.disconnect();
  }, 20000);
});
