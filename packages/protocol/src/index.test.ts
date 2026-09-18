import { describe, expect, it } from 'vitest';
import {
  COMMAND_CATALOG,
  COMMAND_EXPIRY_SEC,
  CLOCK_SKEW_SEC,
  MAX_COMMAND_MESSAGE_BYTES,
  commandRequestSchema,
  commandResultSchema,
  isExpired,
  isMessageTooLarge,
  isOutsideClockSkew,
} from './index.js';

const base = {
  v: 1,
  type: 'command.request',
  commandId: '11111111-1111-4111-8111-111111111111',
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
  computerId: '33333333-3333-4333-8333-333333333333',
  name: 'system.lock',
  args: {},
  requestedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  requestContext: { mobileSessionId: '44444444-4444-4444-8444-444444444444' },
} as const;

describe('protocol v1', () => {
  it('accepts a valid command.request', () => {
    expect(commandRequestSchema.safeParse({ ...base }).success).toBe(true);
  });

  it('rejects unknown top-level fields (fail closed)', () => {
    const r = commandRequestSchema.safeParse({ ...base, injected: true });
    expect(r.success).toBe(false);
  });

  it('rejects unknown args fields', () => {
    const r = commandRequestSchema.safeParse({ ...base, args: { extra: 1 } });
    expect(r.success).toBe(false);
  });

  it('rejects shell.execute (never in MVP)', () => {
    const r = commandRequestSchema.safeParse({ ...base, name: 'shell.execute' });
    expect(r.success).toBe(false);
  });

  it('rejects raw-path app.launch (ID only)', () => {
    const r = commandRequestSchema.safeParse({
      ...base,
      name: 'app.launch',
      args: { path: 'C:\\Windows\\System32\\cmd.exe' },
    });
    expect(r.success).toBe(false);
  });

  it('enforces notification ≤200 chars and clipboard ≤4KB', () => {
    const tooLong = commandRequestSchema.safeParse({
      ...base,
      name: 'notification.show',
      args: { title: 't', body: 'x'.repeat(201) },
    });
    expect(tooLong.success).toBe(false);
    const tooBig = commandRequestSchema.safeParse({
      ...base,
      name: 'clipboard.setText',
      args: { text: 'x'.repeat(4097) },
    });
    expect(tooBig.success).toBe(false);
  });

  it('rejects expiresAt <= requestedAt', () => {
    const r = commandRequestSchema.safeParse({
      ...base,
      expiresAt: base.requestedAt,
    });
    expect(r.success).toBe(false);
  });

  it('detects expired / skewed timestamps', () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
    expect(
      isOutsideClockSkew(new Date(Date.now() - (CLOCK_SKEW_SEC + 5) * 1000).toISOString()),
    ).toBe(true);
    expect(isOutsideClockSkew(new Date().toISOString())).toBe(false);
  });

  it('enforces the 64KB message cap', () => {
    expect(isMessageTooLarge({ ...base })).toBe(false);
    expect(
      isMessageTooLarge({
        ...base,
        name: 'clipboard.setText',
        args: { text: 'x'.repeat(MAX_COMMAND_MESSAGE_BYTES) },
      }),
    ).toBe(true);
  });

  it('requires monotonic sequence on results', () => {
    const ok = commandResultSchema.safeParse({
      v: 1,
      type: 'command.result',
      commandId: base.commandId,
      status: 'succeeded',
      sequence: 3,
      completedAt: new Date().toISOString(),
      result: { locked: true },
      error: null,
    });
    expect(ok.success).toBe(true);
    const bad = commandResultSchema.safeParse({
      v: 1,
      type: 'command.result',
      commandId: base.commandId,
      status: 'succeeded',
      sequence: -1,
      completedAt: new Date().toISOString(),
      result: null,
      error: null,
    });
    expect(bad.success).toBe(false);
  });

  it('catalog quotas match docs/protocol.md', () => {
    expect(COMMAND_CATALOG['system.getStatus'].quota).toEqual({ limit: 1, windowSec: 5 });
    expect(COMMAND_CATALOG['system.lock'].quota).toEqual({ limit: 1, windowSec: 10 });
    expect(COMMAND_CATALOG['system.restart'].quota).toEqual({ limit: 2, windowSec: 3600 });
    expect(COMMAND_EXPIRY_SEC).toBe(60);
  });
});
