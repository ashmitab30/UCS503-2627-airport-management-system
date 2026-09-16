import { jest } from '@jest/globals';

// Same mocking approach as tests/shiftConflict.test.js: mock the shared
// pool module before importing anything that transitively depends on
// it, so this test exercises conflict LOGIC, never a real database.
const mockQuery = jest.fn();
jest.unstable_mockModule('../src/db/pool.js', () => ({
  pool: { query: mockQuery },
}));

const { computeGateWindow, checkGateConflict } = await import('../src/services/gateConflict.js');

describe('computeGateWindow', () => {
  test('buffer width matches the aircraft size class', () => {
    const dep = new Date('2026-03-01T10:00:00Z');
    const { start, end } = computeGateWindow(dep, 'medium'); // 40 min buffer
    expect(start.toISOString()).toBe('2026-03-01T09:20:00.000Z');
    expect(end.toISOString()).toBe('2026-03-01T10:40:00.000Z');
  });

  test('falls back to the medium buffer for an unrecognized size class', () => {
    const dep = new Date('2026-03-01T10:00:00Z');
    const a = computeGateWindow(dep, 'medium');
    const b = computeGateWindow(dep, 'not_a_real_size');
    expect(b.start.toISOString()).toBe(a.start.toISOString());
    expect(b.end.toISOString()).toBe(a.end.toISOString());
  });
});

describe('checkGateConflict', () => {
  beforeEach(() => mockQuery.mockReset());

  test('rejects an inverted window before ever querying the DB', async () => {
    const result = await checkGateConflict(1, '2026-03-01T10:40:00Z', '2026-03-01T09:20:00Z');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_range');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('no candidates at the gate means no conflict', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await checkGateConflict(1, '2026-03-01T09:20:00Z', '2026-03-01T10:40:00Z');
    expect(result.ok).toBe(true);
  });

  test('a candidate whose OWN window overlaps is reported as a conflict', async () => {
    // Existing flight: medium aircraft departing 10:00 -> window [09:20, 10:40]
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, flight_number: 'AI101', scheduled_departure: '2026-03-01T10:00:00Z', size_class: 'medium' }],
    });
    // New flight's own window: small aircraft departing 10:30 -> window [10:05, 10:55]
    const newWindow = computeGateWindow('2026-03-01T10:30:00Z', 'small');
    const result = await checkGateConflict(1, newWindow.start, newWindow.end);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('gate_occupied');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].id).toBe(5);
  });

  test('a candidate far enough away (own window included) does NOT conflict', async () => {
    // Existing flight departs 06:00, own window is tiny and long past by 10:30
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 6, flight_number: 'AI900', scheduled_departure: '2026-03-01T06:00:00Z', size_class: 'small' }],
    });
    const newWindow = computeGateWindow('2026-03-01T10:30:00Z', 'small');
    const result = await checkGateConflict(1, newWindow.start, newWindow.end);
    expect(result.ok).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  test('excludeFlightId is forwarded as a query parameter (update-in-place case)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await checkGateConflict(1, '2026-03-01T09:20:00Z', '2026-03-01T10:40:00Z', 42);
    const [queryText, params] = mockQuery.mock.calls[0];
    expect(queryText).toMatch(/f\.id <> \$4/);
    expect(params[3]).toBe(42);
  });
});
