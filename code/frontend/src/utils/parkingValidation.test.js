import { describe, it, expect } from 'vitest';
import {
  validateVehiclePlate,
  calculateParkingPrice,
  getParkingStatusBadgeStyle,
} from './parkingValidation.js';

describe('Task 11: Indian Vehicle Plate Validation', () => {
  it('accepts standard Indian plate formats (e.g. MH12AB1234 and DL1CAB1234)', () => {
    const mh = validateVehiclePlate('MH12AB1234');
    expect(mh.valid).toBe(true);
    expect(mh.plate).toBe('MH12AB1234');

    const dl = validateVehiclePlate('DL1CAB1234');
    expect(dl.valid).toBe(true);
    expect(dl.plate).toBe('DL1CAB1234');

    const ka = validateVehiclePlate('KA05D9999');
    expect(ka.valid).toBe(true);
    expect(ka.plate).toBe('KA05D9999');

    const dlOlder = validateVehiclePlate('DL01A1234');
    expect(dlOlder.valid).toBe(true);
    expect(dlOlder.plate).toBe('DL01A1234');
  });

  it('accepts Bharat series registration plates (e.g. 22BH1234AA)', () => {
    const bh = validateVehiclePlate('22BH1234AA');
    expect(bh.valid).toBe(true);
    expect(bh.plate).toBe('22BH1234AA');
  });

  it('normalises whitespace and lowercase letters to uppercase', () => {
    const res = validateVehiclePlate(' mh 12 ab 1234 ');
    expect(res.valid).toBe(true);
    expect(res.plate).toBe('MH12AB1234');
  });

  it('rejects empty, null, or undefined plate values', () => {
    expect(validateVehiclePlate('').valid).toBe(false);
    expect(validateVehiclePlate('   ').valid).toBe(false);
    expect(validateVehiclePlate(null).valid).toBe(false);
    expect(validateVehiclePlate(undefined).valid).toBe(false);
  });

  it('rejects invalid, malformed, or out-of-spec plate values', () => {
    expect(validateVehiclePlate('ABC').valid).toBe(false);
    expect(validateVehiclePlate('12345').valid).toBe(false);
    expect(validateVehiclePlate('MH12').valid).toBe(false);
    expect(validateVehiclePlate('TOOLONGPLATE123456789').valid).toBe(false);
    expect(validateVehiclePlate('MH12@1234').valid).toBe(false);
  });
});

describe('Task 11: Parking Duration & Price Calculation', () => {
  const hourlyRate = 60.00; // ₹60/hr

  it('calculates exact 1-hour parking duration', () => {
    const res = calculateParkingPrice('2026-11-25T10:00', '2026-11-25T11:00', hourlyRate);
    expect(res.valid).toBe(true);
    expect(res.hours).toBe(1);
    expect(res.amountRupees).toBe(60.00);
    expect(res.amountPaise).toBe(6000);
  });

  it('rounds UP partial hours (e.g. 1 hour and 5 minutes = 2 hours charge)', () => {
    const res = calculateParkingPrice('2026-11-25T10:00', '2026-11-25T11:05', hourlyRate);
    expect(res.valid).toBe(true);
    expect(res.hours).toBe(2);
    expect(res.amountRupees).toBe(120.00);
    expect(res.amountPaise).toBe(12000);
  });

  it('rounds UP partial hours (e.g. 2 hours and 55 minutes = 3 hours charge)', () => {
    const res = calculateParkingPrice('2026-11-25T10:00', '2026-11-25T12:55', 75.50);
    expect(res.valid).toBe(true);
    expect(res.hours).toBe(3);
    expect(res.amountRupees).toBe(226.50);
    expect(res.amountPaise).toBe(22650);
  });

  it('rejects end time earlier than or equal to start time', () => {
    const equal = calculateParkingPrice('2026-11-25T10:00', '2026-11-25T10:00', hourlyRate);
    expect(equal.valid).toBe(false);
    expect(equal.error).toContain('after start time');

    const earlier = calculateParkingPrice('2026-11-25T12:00', '2026-11-25T10:00', hourlyRate);
    expect(earlier.valid).toBe(false);
    expect(earlier.error).toContain('after start time');
  });

  it('rejects reservation durations exceeding 30 days', () => {
    const res = calculateParkingPrice('2026-11-01T10:00', '2026-12-05T10:00', hourlyRate);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('cannot exceed 30 days');
  });
});

describe('Task 11: Parking Status Badge Styling', () => {
  it('provides visual styles for reserved, active, completed, cancelled', () => {
    ['reserved', 'active', 'completed', 'cancelled'].forEach((st) => {
      const style = getParkingStatusBadgeStyle(st);
      expect(style.color).toBeDefined();
      expect(style.backgroundColor).toBeDefined();
    });
  });
});
