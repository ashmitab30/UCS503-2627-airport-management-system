import { jest } from '@jest/globals';

const mockQuery = jest.fn();
jest.unstable_mockModule('../src/db/pool.js', () => ({
  pool: { query: mockQuery },
}));

const { checkResourceConflict } = await import('../src/services/resourceConflict.js');

describe('checkResourceConflict', () => {
  beforeEach(() => mockQuery.mockReset());

  test('rejects an inverted range before ever hitting the DB', async () => {
    const result = await checkResourceConflict(1, '2026-03-01T16:00Z', '2026-03-01T08:00Z');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_range');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns ok:true when the DB finds no overlapping assignment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await checkResourceConflict(3, '2026-03-01T08:00Z', '2026-03-01T09:00Z');
    expect(result.ok).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  test('returns ok:false with the conflicting assignment when the DB finds an overlap', async () => {
    const conflicting = { id: 11, start_time: '2026-03-01T08:30Z', end_time: '2026-03-01T09:15Z', flight_id: 7 };
    mockQuery.mockResolvedValueOnce({ rows: [conflicting] });

    const result = await checkResourceConflict(3, '2026-03-01T08:00Z', '2026-03-01T09:00Z');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('overlap');
    expect(result.conflicts).toEqual([conflicting]);
  });

  test('passes excludeAssignmentId through to the query params', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await checkResourceConflict(3, '2026-03-01T08:00Z', '2026-03-01T09:00Z', 77);

    const [queryText, params] = mockQuery.mock.calls[0];
    expect(queryText).toMatch(/id <> \$4/);
    expect(params).toEqual([3, '2026-03-01T08:00Z', '2026-03-01T09:00Z', 77]);
  });
});
