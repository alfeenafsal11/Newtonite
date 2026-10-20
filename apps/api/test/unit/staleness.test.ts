import { describe, it, expect } from 'vitest';
import { staleAtFor, isStale, isOverdue } from '../../src/domain/staleness.js';

describe('staleness domain module', () => {
  const baseTime = new Date('2026-10-20T12:00:00.000Z');

  it('computes correct thresholds per priority', () => {
    const p0Stale = staleAtFor('p0', baseTime);
    expect(p0Stale.getTime() - baseTime.getTime()).toBe(2 * 60 * 60 * 1000);

    const p1Stale = staleAtFor('p1', baseTime);
    expect(p1Stale.getTime() - baseTime.getTime()).toBe(24 * 60 * 60 * 1000);

    const p2Stale = staleAtFor('p2', baseTime);
    expect(p2Stale.getTime() - baseTime.getTime()).toBe(72 * 60 * 60 * 1000);

    const p3Stale = staleAtFor('p3', baseTime);
    expect(p3Stale.getTime() - baseTime.getTime()).toBe(168 * 60 * 60 * 1000);
  });

  it('honors custom config overrides if provided', () => {
    const p0Custom = staleAtFor('p0', baseTime, { p0Hours: 4 });
    expect(p0Custom.getTime() - baseTime.getTime()).toBe(4 * 60 * 60 * 1000);
  });

  it('evaluates isStale correctly based on current time', () => {
    const staleTime = new Date('2026-10-20T10:00:00.000Z');
    const futureStaleTime = new Date('2026-10-20T14:00:00.000Z');

    expect(isStale({ status: 'in_progress', stale_at: staleTime }, baseTime)).toBe(true);
    expect(isStale({ status: 'in_progress', stale_at: futureStaleTime }, baseTime)).toBe(false);
  });

  it('resolved and closed items are never stale or overdue', () => {
    const pastTime = new Date('2026-10-20T08:00:00.000Z');

    expect(isStale({ status: 'resolved', stale_at: pastTime }, baseTime)).toBe(false);
    expect(isStale({ status: 'closed', stale_at: pastTime }, baseTime)).toBe(false);

    expect(isOverdue({ status: 'resolved', due_at: pastTime }, baseTime)).toBe(false);
    expect(isOverdue({ status: 'closed', due_at: pastTime }, baseTime)).toBe(false);
  });

  it('evaluates isOverdue correctly for active items', () => {
    const pastDue = new Date('2026-10-20T11:00:00.000Z');
    const futureDue = new Date('2026-10-20T15:00:00.000Z');

    expect(isOverdue({ status: 'in_progress', due_at: pastDue }, baseTime)).toBe(true);
    expect(isOverdue({ status: 'in_progress', due_at: futureDue }, baseTime)).toBe(false);
    expect(isOverdue({ status: 'in_progress', due_at: null }, baseTime)).toBe(false);
  });
});
