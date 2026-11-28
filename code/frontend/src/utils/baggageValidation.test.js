import { describe, it, expect } from 'vitest';
import {
  validateWeight,
  getNextStatuses,
  getStatusBadgeStyle,
  BAGGAGE_STATUSES,
  BAGGAGE_TRANSITIONS,
  BAGGAGE_WEIGHT_MIN,
  BAGGAGE_WEIGHT_MAX,
} from './baggageValidation.js';

describe('Task 10: Baggage Weight Validation', () => {
  it('rejects missing, empty, or non-numeric weight values', () => {
    expect(validateWeight(null).valid).toBe(false);
    expect(validateWeight(undefined).valid).toBe(false);
    expect(validateWeight('').valid).toBe(false);
    expect(validateWeight('   ').valid).toBe(false);
    expect(validateWeight('abc').valid).toBe(false);
  });

  it('rejects weights below minimum (0.1 kg)', () => {
    expect(validateWeight(0).valid).toBe(false);
    expect(validateWeight(-5).valid).toBe(false);
    expect(validateWeight('0.05').valid).toBe(false);
    expect(validateWeight(0.09).error).toContain(`at least ${BAGGAGE_WEIGHT_MIN}`);
  });

  it('rejects weights exceeding maximum (32.0 kg)', () => {
    expect(validateWeight(32.1).valid).toBe(false);
    expect(validateWeight(50).valid).toBe(false);
    expect(validateWeight('32.01').valid).toBe(false);
    expect(validateWeight(35).error).toContain(`cannot exceed ${BAGGAGE_WEIGHT_MAX}`);
  });

  it('accepts valid weights within [0.1, 32.0] kg range and returns rounded numeric', () => {
    const minRes = validateWeight(0.1);
    expect(minRes.valid).toBe(true);
    expect(minRes.numeric).toBe(0.1);

    const midRes = validateWeight('18.55');
    expect(midRes.valid).toBe(true);
    expect(midRes.numeric).toBe(18.55);

    const maxRes = validateWeight(32.0);
    expect(maxRes.valid).toBe(true);
    expect(maxRes.numeric).toBe(32);
  });
});

describe('Task 10: Baggage Status Pipeline Transitions', () => {
  it('allows checked_in -> loaded and checked_in -> lost', () => {
    const next = getNextStatuses('checked_in');
    expect(next).toEqual(['loaded', 'lost']);
  });

  it('allows loaded -> in_transit and loaded -> lost', () => {
    const next = getNextStatuses('loaded');
    expect(next).toEqual(['in_transit', 'lost']);
  });

  it('allows in_transit -> arrived and in_transit -> lost', () => {
    const next = getNextStatuses('in_transit');
    expect(next).toEqual(['arrived', 'lost']);
  });

  it('has no transitions for terminal states arrived and lost', () => {
    expect(getNextStatuses('arrived')).toEqual([]);
    expect(getNextStatuses('lost')).toEqual([]);
  });

  it('handles unknown status gracefully', () => {
    expect(getNextStatuses('unknown_status')).toEqual([]);
  });
});

describe('Task 10: Baggage Status Badge Styling', () => {
  it('provides distinct badge styling for all 5 statuses', () => {
    BAGGAGE_STATUSES.forEach((status) => {
      const style = getStatusBadgeStyle(status);
      expect(style).toBeDefined();
      expect(style.color).toBeDefined();
      expect(style.backgroundColor).toBeDefined();
    });
  });
});
