import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { db } from '../lib/db.js';
import { newOpaqueToken, newUserCode, normalizeUserCode, safeEqualHex, sha256Hex } from '../lib/secrets.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { toComputerShape } from './computers.js';

export const pairingRouter = Router();

const PAIRING_TTL_MS = 5 * 60 * 1000;

interface ComputerMeta {
  displayName?: string;
  publicKey?: string;
  computerId?: string;
}

function metaOf(row: { computerMeta: unknown }): ComputerMeta {
  return (row.computerMeta as ComputerMeta | null) ?? {};
}

// --- Agent: open a device-code session; PC shows code + QR of pairingId ---
pairingRouter.post('/device-code', async (req, res, next) => {
  try {
    const body = z
      .object({
        publicKey: z.string().min(10).max(2000),
        displayName: z.string().min(1).max(100),
      })
      .strict()
      .parse(req.body);
    const userCode = newUserCode();
    const pollingSecret = newOpaqueToken();
    const session = await db.pairingSession.create({
      data: {
        userCodeHash: sha256Hex(normalizeUserCode(userCode)),
        secretHash: sha256Hex(normalizeUserCode(userCode)),
        pollingSecretH: sha256Hex(pollingSecret),
        computerMeta: { displayName: body.displayName, publicKey: body.publicKey },
        expiresAt: new Date(Date.now() + PAIRING_TTL_MS),
      },
    });
    res.status(201).json({
      pairingId: session.id,
      userCode,
      expiresAt: session.expiresAt.toISOString(),
      pollingSecret,
    });
  } catch (err) {
    next(err);
  }
});

function bearerSecret(req: { header: (n: string) => string | undefined }): string {
  const header = req.header('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

async function loadLiveSession(pairingId: string) {
  if (!z.string().uuid().safeParse(pairingId).success) {
    throw new ApiError('INVALID_ARGUMENT', 400, 'Invalid pairing id.');
  }
  const session = await db.pairingSession.findUnique({ where: { id: pairingId } });
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    throw new ApiError('COMMAND_EXPIRED', 410, 'Pairing session expired. Start over on the PC.');
  }
  if (session.usedAt) {
    throw new ApiError('DUPLICATE_COMMAND', 409, 'Pairing session already used.');
  }
  return session;
}

// --- Agent: poll for mobile approval (polling-secret auth, never the account) ---
// Readable before AND after approval (until expiry) — the agent learns the
// verdict by polling. Single-use is enforced at confirm time, not here.
pairingRouter.get('/:id/status', async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      throw new ApiError('INVALID_ARGUMENT', 400, 'Invalid pairing id.');
    }
    const session = await db.pairingSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new ApiError('COMMAND_EXPIRED', 410, 'Pairing session expired. Start over on the PC.');
    }
    if (!session.pollingSecretH || !safeEqualHex(sha256Hex(bearerSecret(req)), session.pollingSecretH)) {
      throw new ApiError('AUTH_REQUIRED', 401, 'Authentication required.');
    }
    const meta = metaOf(session);
    if (!meta.computerId) {
      res.status(404).json({ status: 'pending' });
      return;
    }
    res.json({ status: 'approved', computerId: meta.computerId });
  } catch (err) {
    next(err);
  }
});

// --- Agent: issue (and rotate) the device credential after approval ---
// Requires an APPROVED (used) session; each call rotates the credential.
pairingRouter.post('/:id/credential', async (req, res, next) => {
  try {
    const body = z.object({ pollingSecret: z.string().min(16) }).strict().parse(req.body);
    if (!z.string().uuid().safeParse(req.params.id).success) {
      throw new ApiError('INVALID_ARGUMENT', 400, 'Invalid pairing id.');
    }
    const session = await db.pairingSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new ApiError('COMMAND_EXPIRED', 410, 'Pairing session expired. Start over on the PC.');
    }
    if (!session.pollingSecretH || !safeEqualHex(sha256Hex(body.pollingSecret), session.pollingSecretH)) {
      throw new ApiError('AUTH_REQUIRED', 401, 'Authentication required.');
    }
    const meta = metaOf(session);
    if (!session.usedAt || !meta.computerId) {
      throw new ApiError('CONFLICT', 409, 'Pairing not approved yet.');
    }
    const computer = await db.computer.findUnique({ where: { id: meta.computerId } });
    if (!computer || computer.revokedAt) throw new ApiError('NOT_FOUND', 404, 'Computer not found.');
    // Rotate: revoke prior credentials, issue a fresh one; raw value leaves here once.
    await db.computerCredential.updateMany({
      where: { computerId: computer.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const credential = newOpaqueToken();
    const row = await db.computerCredential.create({
      data: { computerId: computer.id, credentialHash: sha256Hex(credential) },
    });
    res.status(201).json({ credentialId: row.id, credential, computerId: computer.id });
  } catch (err) {
    next(err);
  }
});

// --- Mobile: preview a scanned QR (pairingId) or typed user code ---
pairingRouter.get('/preview', requireAuth, async (req, res, next) => {
  try {
    const code = z.string().min(4).max(64).parse(req.query.code);
    const asId = z.string().uuid().safeParse(code.trim());
    const session = asId.success
      ? await db.pairingSession.findUnique({ where: { id: asId.data } })
      : await db.pairingSession.findFirst({
          where: { userCodeHash: sha256Hex(normalizeUserCode(code)) },
          orderBy: { createdAt: 'desc' },
        });
    if (!session || session.expiresAt.getTime() <= Date.now() || session.usedAt) {
      throw new ApiError('NOT_FOUND', 404, 'Pairing code not found or expired.');
    }
    const me = await db.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    res.json({
      pairingId: session.id,
      computerName: metaOf(session).displayName ?? 'Unknown PC',
      accountEmail: me.email,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// --- Mobile: approve — binds a computer to the owner, agent credential follows ---
pairingRouter.post('/:id/confirm', requireAuth, async (req, res, next) => {
  try {
    const session = await loadLiveSession(req.params.id);
    const meta = metaOf(session);
    const computer = await db.computer.create({
      data: {
        ownerUserId: req.auth!.userId,
        displayName: (meta.displayName ?? 'Windows PC').slice(0, 100),
        platform: 'windows',
        publicKey: meta.publicKey?.slice(0, 2000),
      },
    });
    await db.pairingSession.update({
      where: { id: session.id },
      data: {
        usedAt: new Date(),
        ownerUserId: req.auth!.userId,
        computerMeta: { ...meta, computerId: computer.id },
      },
    });
    await db.auditEvent.create({
      data: {
        actorType: 'user',
        actorId: req.auth!.userId,
        computerId: computer.id,
        action: 'pairing.confirm',
        outcome: 'succeeded',
        ipContext: req.ip,
      },
    });
    res.status(201).json(await toComputerShape(computer));
  } catch (err) {
    next(err);
  }
});
