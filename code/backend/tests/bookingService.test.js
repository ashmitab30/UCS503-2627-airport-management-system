import { generateBookingRef, calculateSeatPriceCents } from '../src/services/bookingService.js';

describe('Booking Service Unit Tests', () => {
  test('generateBookingRef produces valid reference strings and no collisions', () => {
    const refs = new Set();
    for (let i = 0; i < 500; i++) {
      const ref = generateBookingRef();
      expect(ref).toMatch(/^BK[2-9A-HJ-NP-Z]{6}$/);
      refs.add(ref);
    }
    expect(refs.size).toBe(500);
  });

  test('calculateSeatPriceCents applies correct multipliers', () => {
    const base = 5000;
    expect(calculateSeatPriceCents(base, 'economy')).toBe(5000);
    expect(calculateSeatPriceCents(base, 'premium_economy')).toBe(7000);
    expect(calculateSeatPriceCents(base, 'business')).toBe(11000);
    expect(calculateSeatPriceCents(base, 'first')).toBe(17500);
    expect(calculateSeatPriceCents(base, 'unknown')).toBe(5000);
  });
});

