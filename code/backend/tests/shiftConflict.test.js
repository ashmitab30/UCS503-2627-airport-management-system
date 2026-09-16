import { jest } from '@jest/globals';

// pool.js opens a real pg Pool at import time (reads env vars), which
// we don't want during unit tests — mock it before importing the
// service that depends on it, so checkShiftConflict never touches a
// real database. This tests the *conflict logic*, not connectivity.
const mockQuery = jest.fn();
jest.unstable_mockModule('../src/db/pool.js', () => ({
  pool: { query: mockQuery },
}));

const { rangesOverlap, checkShiftConflict } = await import('../src/services/shiftConflict.js');

describe('rangesOverlap (pure function)', () => {
  test('overlapping ranges return true', () => {
    expect(rangesOverlap(
      new Date('2026-01-01T08:00Z'), new Date('2026-01-01T16:00Z'),
      new Date('2026-01-01T14:00Z'), new Date('2026-01-01T22:00Z')
    )).toBe(true);
  });

  test('adjacent ranges (back-to-back, no overlap) return false', () => {
    expect(rangesOverlap(
      new Date('2026-01-01T08:00Z'), new Date('2026-01-01T16:00Z'),
      new Date('2026-01-01T16:00Z'), new Date('2026-01-01T22:00Z')
    )).toBe(false);
  });

  test('fully disjoint ranges return false', () => {
    expect(rangesOverlap(
      new Date('2026-01-01T08:00Z'), new Date('2026-01-01T12:00Z'),
      new Date('2026-01-01T18:00Z'), new Date('2026-01-01T22:00Z')
    )).toBe(false);
  });

  test('one range fully inside another returns true', () => {
    expect(rangesOverlap(
      new Date('2026-01-01T08:00Z'), new Date('2026-01-01T22:00Z'),
      new Date('2026-01-01T10:00Z'), new Date('2026-01-01T12:00Z')
    )).toBe(true);
  });
});

describe('checkShiftConflict (DB-backed, mocked)', () => {
  beforeEach(() => mockQuery.mockReset());

  test('rejects an inverted range before ever hitting the DB', async () => {
    const result = await checkShiftConflict(1, '2026-01-01T16:00Z', '2026-01-01T08:00Z');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_range');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns ok:true when the DB finds no overlapping shifts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await checkShiftConflict(1, '2026-01-01T08:00Z', '2026-01-01T16:00Z');
    expect(result.ok).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  test('returns ok:false with the conflicting rows when the DB finds an overlap', async () => {
    const conflictingShift = { id: 42, start_time: '2026-01-01T14:00Z', end_time: '2026-01-01T22:00Z' };
    mockQuery.mockResolvedValueOnce({ rows: [conflictingShift] });

    const result = await checkShiftConflict(1, '2026-01-01T08:00Z', '2026-01-01T16:00Z');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('overlap');
    expect(result.conflicts).toEqual([conflictingShift]);
  });

  test('passes excludeShiftId through to the query params for update checks', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await checkShiftConflict(1, '2026-01-01T08:00Z', '2026-01-01T16:00Z', 99);

    const [queryText, params] = mockQuery.mock.calls[0];
    expect(queryText).toMatch(/id <> \$4/);
    expect(params).toEqual([1, '2026-01-01T08:00Z', '2026-01-01T16:00Z', 99]);
  });
});
