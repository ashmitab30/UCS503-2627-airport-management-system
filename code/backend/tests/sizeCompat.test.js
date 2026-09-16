import { gateCanHost, SIZE_ORDER, TURNAROUND_MINUTES } from '../src/services/sizeCompat.js';

describe('gateCanHost', () => {
  test('an aircraft can use a gate of the exact same size', () => {
    expect(gateCanHost('medium', 'medium')).toBe(true);
  });

  test('a small aircraft can use a larger gate', () => {
    expect(gateCanHost('small', 'large')).toBe(true);
  });

  test('a large aircraft cannot use a smaller gate', () => {
    expect(gateCanHost('large', 'small')).toBe(false);
  });

  test('a jumbo aircraft cannot use a medium gate', () => {
    expect(gateCanHost('jumbo', 'medium')).toBe(false);
  });

  test('unknown size classes are treated as incompatible, not thrown', () => {
    expect(gateCanHost('supersonic', 'large')).toBe(false);
  });
});

describe('SIZE_ORDER / TURNAROUND_MINUTES', () => {
  test('size order is strictly increasing small -> jumbo', () => {
    expect(SIZE_ORDER.small).toBeLessThan(SIZE_ORDER.medium);
    expect(SIZE_ORDER.medium).toBeLessThan(SIZE_ORDER.large);
    expect(SIZE_ORDER.large).toBeLessThan(SIZE_ORDER.jumbo);
  });

  test('turnaround buffer grows with aircraft size', () => {
    expect(TURNAROUND_MINUTES.small).toBeLessThan(TURNAROUND_MINUTES.medium);
    expect(TURNAROUND_MINUTES.medium).toBeLessThan(TURNAROUND_MINUTES.large);
    expect(TURNAROUND_MINUTES.large).toBeLessThan(TURNAROUND_MINUTES.jumbo);
  });
});
