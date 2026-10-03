import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/errors.js';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  /** Bucket prefix so different limiters don't share counters. */
  scope?: string;
}

/**
 * Simple single-instance sliding-window rate limiter (per IP).
 * Redis-backed when horizontally scaled (plan.md §6 scaling note).
 */
export function createRateLimiter(opts: RateLimiterOptions) {
  const hits = new Map<string, number[]>();
  // Periodically drop empty buckets so the map cannot grow unbounded.
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - opts.windowMs;
    for (const [key, arr] of hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }, opts.windowMs);
  sweeper.unref?.();

  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const now = Date.now();
      const cutoff = now - opts.windowMs;
      const key = `${opts.scope ?? 'global'}|${req.ip ?? 'unknown'}`;
      const arr = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (arr.length >= opts.max) {
        throw new ApiError('RATE_LIMITED', 429, 'Too many requests. Try again later.');
      }
      arr.push(now);
      hits.set(key, arr);
      next();
    } catch (err) {
      next(err);
    }
  };
}
