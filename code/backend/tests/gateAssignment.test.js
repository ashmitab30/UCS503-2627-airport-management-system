import { jest } from '@jest/globals';

const mockQuery = jest.fn();
jest.unstable_mockModule('../src/db/pool.js', () => ({
  pool: { query: mockQuery },
}));

const { suggestGate } = await import('../src/services/gateAssignment.js');

describe('suggestGate', () => {
  beforeEach(() => mockQuery.mockReset());

  test('picks the smallest compatible, non-conflicting gate', async () => {
    // 1) gate list at the origin airport, smallest size first (as the
    //    service's ORDER BY produces)
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, code: 'A1', size_class: 'small' },
        { id: 2, code: 'A2', size_class: 'medium' },
        { id: 3, code: 'B1', size_class: 'large' },
      ],
    });
    // 2) conflict check for gate 1 (first compatible gate) -> no candidates -> free
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { gate, reason } = await suggestGate(1, 'small', '2026-03-01T10:00:00Z');
    expect(reason).toBeNull();
    expect(gate.id).toBe(1);
    expect(mockQuery).toHaveBeenCalledTimes(2); // gate list + one conflict check, stopped at first free gate
  });

  test('skips a busy gate and picks the next compatible one', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, code: 'A1', size_class: 'small' },
        { id: 2, code: 'A2', size_class: 'medium' },
      ],
    });
    // Gate 1: conflicting flight found
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 99, flight_number: 'AI200', scheduled_departure: '2026-03-01T10:00:00Z', size_class: 'small' }],
    });
    // Gate 2: free
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { gate, reason } = await suggestGate(1, 'small', '2026-03-01T10:00:00Z');
    expect(reason).toBeNull();
    expect(gate.id).toBe(2);
  });

  test('returns no_compatible_gate when nothing at the airport is big enough', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, code: 'A1', size_class: 'small' }],
    });
    const { gate, reason } = await suggestGate(1, 'large', '2026-03-01T10:00:00Z');
    expect(gate).toBeNull();
    expect(reason).toBe('no_compatible_gate');
    // Only the gate-list query should have run — no point checking
    // conflicts for a gate that's too small to begin with.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('returns all_compatible_gates_busy when every compatible gate conflicts', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, code: 'A1', size_class: 'medium' }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, flight_number: 'AI500', scheduled_departure: '2026-03-01T10:00:00Z', size_class: 'medium' }],
    });

    const { gate, reason } = await suggestGate(1, 'medium', '2026-03-01T10:00:00Z');
    expect(gate).toBeNull();
    expect(reason).toBe('all_compatible_gates_busy');
  });
});
