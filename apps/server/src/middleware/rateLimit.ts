import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/errors.js';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  /** Bucket prefix so different limiters don't share counters. */
  scope?: string;
}

/** Async sliding-window counter. observe returns true = within the limit. */
export interface RateLimitCounter {
  observe(key: string, windowMs: number, max: number): Promise<boolean>;
  close?(): Promise<void>;
}

/** In-memory counter (single-instance default; Redis used when REDIS_URL set). */
export class MemoryRateLimitCounter implements RateLimitCounter {
  private hits = new Map<string, number[]>();
  private sweeper: ReturnType<typeof setInterval>;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  async observe(key: string, windowMs: number, max: number): Promise<boolean> {
    const now = Date.now();
    const cutoff = now - windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    const allowed = arr.length < max;
    // Over-limit hits are still counted (dampens retry storms).
    arr.push(now);
    this.hits.set(key, arr);
    return allowed;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, arr] of this.hits) {
      const kept = arr.filter((t) => now - t < 60_000);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }

  async close(): Promise<void> {
    clearInterval(this.sweeper);
  }
}

/** Redis-backed counter (shared across server instances), ZSET per key. */
export class RedisRateLimitCounter implements RateLimitCounter {
  private ready: Promise<unknown>;
  private broke = false;
  private client: import('redis').RedisClientType | null = null;

  constructor(private url: string, private prefix = 'rl') {
    this.ready = this.connect();
  }

  private async connect(): Promise<void> {
    try {
      const { createClient } = await import('redis');
      const client = createClient({ url: this.url });
      client.on('error', () => {});
      this.client = client as import('redis').RedisClientType;
      await client.connect();
    } catch (err) {
      this.broke = true;
      // Fail-open but logged: rate limiting degrades, it does not take down the API.
      console.error('[rate-limit] Redis counter unavailable, failing open:', (err as Error).message);
    }
  }

  async observe(key: string, windowMs: number, max: number): Promise<boolean> {
    if (this.broke || !this.client) return true;
    await this.ready.catch(() => {});
    if (!this.client || this.broke) return true;
    const now = Date.now();
    const zid = `${this.prefix}:${key}`;
    try {
      const multi = this.client.multi();
      multi.zRemRangeByScore(zid, 0, now - windowMs);
      multi.zAdd(zid, { score: now, value: `${now}:${Math.random()}` });
      multi.zCard(zid);
      multi.pExpire(zid, windowMs);
      const results = await multi.exec();
      const count = Number(results[2]);
      return count <= max;
    } catch {
      this.broke = true;
      console.error('[rate-limit] Redis command failed, failing open');
      return true;
    }
  }

  async close(): Promise<void> {
    try {
      await this.client?.quit();
    } catch {
      // ignore
    }
  }
}

/** Default counter choice: Redis when configured + not test, else memory. */
export function defaultRateLimitCounter(): RateLimitCounter {
  const url = process.env.REDIS_URL;
  if (url && process.env.NODE_ENV !== 'test' && process.env.ORBIT_DISABLE_REDIS !== '1') {
    return new RedisRateLimitCounter(url);
  }
  return new MemoryRateLimitCounter();
}

/**
 * Single-instance-friendly sliding-window limiter (per IP). Redis-backed when
 * REDIS_URL is set (multi-instance). Previously inline in auth route.
 */
export function createRateLimiter(opts: RateLimiterOptions, counter?: RateLimitCounter) {
  const c = counter ?? defaultRateLimitCounter();
  return (req: Request, _res: Response, next: NextFunction): void => {
    Promise.resolve(c.observe(`${opts.scope ?? 'global'}|${req.ip ?? 'unknown'}`, opts.windowMs, opts.max))
      .then((allowed) => {
        if (!allowed) next(new ApiError('RATE_LIMITED', 429, 'Too many requests. Try again later.'));
        else next();
      })
      .catch((err) => next(err));
  };
}
