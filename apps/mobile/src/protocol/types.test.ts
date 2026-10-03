import { describe, expect, it } from 'vitest';
import { COMMAND_RISK, isSafeToRetry, type CommandName, type CommandStatus } from './types';

const ALL_NAMES = Object.keys(COMMAND_RISK) as CommandName[];
const DESTRUCTIVE = ALL_NAMES.filter((n) => COMMAND_RISK[n].destructive);
const SAFE = ALL_NAMES.filter((n) => !COMMAND_RISK[n].destructive);

describe('isSafeToRetry (plan.md §20 reconciliation)', () => {
  it('destructive commands are NEVER retried once dispatched (timed_out)', () => {
    for (const name of DESTRUCTIVE) {
      expect(isSafeToRetry(name, 'timed_out')).toBe(false);
    }
  });

  it('destructive commands are NEVER retried while running or delivered', () => {
    for (const name of DESTRUCTIVE) {
      expect(isSafeToRetry(name, 'running')).toBe(false);
      expect(isSafeToRetry(name, 'delivered')).toBe(false);
    }
  });

  it('non-destructive commands retry only on settled failure states', () => {
    for (const name of SAFE) {
      expect(isSafeToRetry(name, 'failed')).toBe(true);
      expect(isSafeToRetry(name, 'expired')).toBe(true);
      expect(isSafeToRetry(name, 'cancelled')).toBe(true);
      expect(isSafeToRetry(name, 'succeeded')).toBe(false);
      expect(isSafeToRetry(name, 'running')).toBe(false);
    }
  });

  it('destructive commands retry on terminal failure but not on uncertain states', () => {
    for (const name of DESTRUCTIVE) {
      expect(isSafeToRetry(name, 'failed')).toBe(true);
      expect(isSafeToRetry(name, 'expired')).toBe(true);
      expect(isSafeToRetry(name, 'timed_out')).toBe(false);
    }
  });

  it('every destructive command requires confirm', () => {
    for (const name of DESTRUCTIVE) {
      expect(COMMAND_RISK[name].confirm).toBe(true);
    }
  });

  it('restart/shutdown require recent auth; sleep does not', () => {
    expect(COMMAND_RISK['system.restart'].requiresRecentAuth).toBe(true);
    expect(COMMAND_RISK['system.shutdown'].requiresRecentAuth).toBe(true);
    expect(COMMAND_RISK['system.sleep'].requiresRecentAuth).toBe(false);
  });

  it('status/lock/launch/notification/clipboard never need recent auth', () => {
    const names: CommandStatus[] = ['queued', 'delivered'];
    for (const name of SAFE) {
      expect(COMMAND_RISK[name].requiresRecentAuth).toBe(false);
    }
    expect(names.length).toBe(2);
  });
});
