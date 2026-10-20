import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, SortOption } from '../../src/domain/cursor.js';

describe('cursor domain module', () => {
  it('round-trips activity_desc sort correctly', () => {
    const row = {
      id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      last_activity_at: new Date('2026-10-20T12:00:00.000Z'),
    };
    const token = encodeCursor('activity_desc', row);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const decoded = decodeCursor('activity_desc', token);
    expect(decoded.s).toBe('activity_desc');
    expect(decoded.id).toBe(row.id);
    expect(decoded.k[0]).toBe('2026-10-20T12:00:00.000Z');
  });

  it('round-trips created_desc sort correctly', () => {
    const row = {
      id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      created_at: new Date('2026-10-20T10:00:00.000Z'),
    };
    const token = encodeCursor('created_desc', row);
    const decoded = decodeCursor('created_desc', token);
    expect(decoded.s).toBe('created_desc');
    expect(decoded.id).toBe(row.id);
    expect(decoded.k[0]).toBe('2026-10-20T10:00:00.000Z');
  });

  it('round-trips priority_due with non-null due_at', () => {
    const row = {
      id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      priority: 'p1',
      due_at: new Date('2026-10-25T15:00:00.000Z'),
    };
    const token = encodeCursor('priority_due', row);
    const decoded = decodeCursor('priority_due', token);
    expect(decoded.s).toBe('priority_due');
    expect(decoded.id).toBe(row.id);
    expect(decoded.k[0]).toBe('p1');
    expect(decoded.k[1]).toBe('2026-10-25T15:00:00.000Z');
  });

  it('round-trips priority_due with NULL due_at correctly', () => {
    const row = {
      id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      priority: 'p2',
      due_at: null,
    };
    const token = encodeCursor('priority_due', row);
    const decoded = decodeCursor('priority_due', token);
    expect(decoded.s).toBe('priority_due');
    expect(decoded.id).toBe(row.id);
    expect(decoded.k[0]).toBe('p2');
    expect(decoded.k[1]).toBe(null);
  });

  it('rejects cursor when expected sort does not match cursor sort', () => {
    const row = {
      id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      last_activity_at: new Date(),
    };
    const token = encodeCursor('activity_desc', row);

    expect(() => decodeCursor('created_desc', token)).toThrow(/does not match/);
    expect(() => decodeCursor('priority_due', token)).toThrow(/does not match/);
  });

  it('rejects tampered or malformed cursor tokens', () => {
    expect(() => decodeCursor('activity_desc', '')).toThrow();
    expect(() => decodeCursor('activity_desc', 'not-valid-base64url!!!')).toThrow();
    const badJson = Buffer.from('{"hello": "world"}').toString('base64url');
    expect(() => decodeCursor('activity_desc', badJson)).toThrow();
  });
});
