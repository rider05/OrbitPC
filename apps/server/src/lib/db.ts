import { PrismaClient } from '@prisma/client';

// Shared Prisma client (serverless-safe: single cached instance per process).
// Tests default to the local dev DB when DATABASE_URL is unset.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://orbit:orbit_dev_pw@127.0.0.1:5432/orbit?schema=public';
}

const globalForPrisma = globalThis as unknown as { __orbitPrisma?: PrismaClient };

export const db: PrismaClient =
  globalForPrisma.__orbitPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__orbitPrisma = db;
}
