import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:8081'),
  DATABASE_URL: z.string().min(1).default('postgresql://orbit:orbit_dev_pw@localhost:5432/orbit'),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32).default('dev-only-change-me-min-32-chars-000000000000'),
  JWT_REFRESH_SECRET: z.string().min(32).default('dev-only-change-me-min-32-chars-111111111111'),
  JWT_ACCESS_TTL_MIN: z.coerce.number().int().min(5).max(30).default(15),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast on bad config; never boot with unknown env shape.
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (parsed.data[key].startsWith('dev-only-')) {
        if (process.env.STRICT_ENV_SECRETS === 'true') {
          throw new Error(`Invalid environment: ${key} must be set to a real secret in production`);
        }
        console.warn(
          `[SECURITY WARNING] ${key} is set to a dev placeholder in production. Configure a secure 32+ char secret in your environment variables.`,
        );
      }
    }
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export function corsOrigins(): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
