import { describe, it, expect } from 'vitest';
import { computeBackoffMs, BASE_BACKOFF_MS, MAX_BACKOFF_MS } from '../../src/domain/backoff.js';

describe('backoff unit tests', () => {
  it('grows monotonically before the cap without jitter', () => {
    const noJitter = () => 0;
    const b1 = computeBackoffMs(1, noJitter);
    const b2 = computeBackoffMs(2, noJitter);
    const b3 = computeBackoffMs(3, noJitter);
    const b4 = computeBackoffMs(4, noJitter);

    expect(b1).toBe(5000);
    expect(b2).toBe(10000);
    expect(b3).toBe(20000);
    expect(b4).toBe(40000);
    expect(b2).toBeGreaterThan(b1);
    expect(b3).toBeGreaterThan(b2);
    expect(b4).toBeGreaterThan(b3);
  });

  it('caps at 15 minutes (900,000 ms) without jitter', () => {
    const noJitter = () => 0;
    const b10 = computeBackoffMs(10, noJitter);
    const b20 = computeBackoffMs(20, noJitter);

    expect(b10).toBe(MAX_BACKOFF_MS);
    expect(b20).toBe(MAX_BACKOFF_MS);
    expect(MAX_BACKOFF_MS).toBe(15 * 60 * 1000);
  });

  it('keeps jitter within [0, 1000) ms bounds', () => {
    for (let attempt = 1; attempt <= 12; attempt++) {
      const val = computeBackoffMs(attempt, Math.random);
      const minExpected = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
      const maxExpected = minExpected + 1000;

      expect(val).toBeGreaterThanOrEqual(minExpected);
      expect(val).toBeLessThanOrEqual(maxExpected);
    }
  });
});
