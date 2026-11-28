import { describe, it, expect } from 'vitest';
import {
  formatINR,
  formatDate,
  formatTime,
  formatDateTime,
  dayOffsetLabel,
  formatFareDifference,
} from './format.js';

describe('formatINR', () => {
  it('handles null, undefined, empty string, and NaN safely with em-dash', () => {
    expect(formatINR(null)).toBe('—');
    expect(formatINR(undefined)).toBe('—');
    expect(formatINR('')).toBe('—');
    expect(formatINR(NaN)).toBe('—');
    expect(formatINR('invalid')).toBe('—');
  });

  it('formats whole rupee amounts without decimals', () => {
    // 0 paise -> ₹0
    expect(formatINR(0)).toBe('₹0');
    // 5000 paise -> ₹50
    expect(formatINR(5000)).toBe('₹50');
    // 450000 paise -> ₹4,500 (Indian grouping)
    expect(formatINR(450000)).toBe('₹4,500');
    // 720000 paise -> ₹7,200
    expect(formatINR(720000)).toBe('₹7,200');
    // 10000000 paise -> ₹1,00,000 (Indian grouping)
    expect(formatINR(10000000)).toBe('₹1,00,000');
  });

  it('formats fractional rupee amounts with 2 decimals', () => {
    // 1234567 paise -> ₹12,345.67
    expect(formatINR(1234567)).toBe('₹12,345.67');
    // 5050 paise -> ₹50.50
    expect(formatINR(5050)).toBe('₹50.50');
  });

  it('handles string numbers correctly', () => {
    expect(formatINR('450000')).toBe('₹4,500');
    expect(formatINR('1234567')).toBe('₹12,345.67');
  });
});

describe('formatDate', () => {
  it('handles invalid or empty inputs safely', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDate('invalid-date')).toBe('—');
  });

  it('formats date in Sat, 28 Nov 2026 format', () => {
    // Create a local date so timezone doesn't shift the day
    const d = new Date(2026, 10, 28, 14, 30); // 28 Nov 2026
    const res = formatDate(d);
    expect(res).toBe('Sat, 28 Nov 2026');
  });
});

describe('formatTime', () => {
  it('handles invalid or empty inputs safely', () => {
    expect(formatTime(null)).toBe('—');
    expect(formatTime(undefined)).toBe('—');
    expect(formatTime('not-a-date')).toBe('—');
  });

  it('formats in 24-hour HH:MM format', () => {
    const d = new Date(2026, 10, 28, 14, 30);
    expect(formatTime(d)).toBe('14:30');

    const dMorning = new Date(2026, 10, 28, 8, 5);
    expect(formatTime(dMorning)).toBe('08:05');
  });
});

describe('formatDateTime', () => {
  it('handles invalid or empty inputs safely', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });

  it('formats in 28 Nov 2026, 14:30 format', () => {
    const d = new Date(2026, 10, 28, 14, 30);
    expect(formatDateTime(d)).toBe('28 Nov 2026, 14:30');
  });
});

describe('dayOffsetLabel', () => {
  it('returns empty string for invalid or missing inputs', () => {
    expect(dayOffsetLabel(null, null)).toBe('');
    expect(dayOffsetLabel('2026-11-28', null)).toBe('');
    expect(dayOffsetLabel(null, '2026-11-28')).toBe('');
    expect(dayOffsetLabel('bad', 'date')).toBe('');
  });

  it('returns empty string when departure and arrival are on the same calendar day', () => {
    const dep = new Date(2026, 10, 28, 14, 30);
    const arr = new Date(2026, 10, 28, 17, 45);
    expect(dayOffsetLabel(dep, arr)).toBe('');
  });

  it('returns "+1 day" for midnight-crossing arrival', () => {
    const dep = new Date(2026, 10, 28, 23, 15);
    const arr = new Date(2026, 10, 29, 1, 45);
    expect(dayOffsetLabel(dep, arr)).toBe('+1 day');
  });

  it('returns "+2 days" when crossing two days', () => {
    const dep = new Date(2026, 10, 28, 22, 0);
    const arr = new Date(2026, 10, 30, 2, 0);
    expect(dayOffsetLabel(dep, arr)).toBe('+2 days');
  });
});

describe('formatFareDifference', () => {
  it('formats positive fare difference as Extra to pay with currency', () => {
    expect(formatFareDifference(120000)).toBe('Extra to pay ₹1,200');
    expect(formatFareDifference(5000)).toBe('Extra to pay ₹50');
    expect(formatFareDifference('150000')).toBe('Extra to pay ₹1,500');
  });

  it('formats negative fare difference as Refund with currency', () => {
    expect(formatFareDifference(-80000)).toBe('Refund ₹800');
    expect(formatFareDifference(-100000)).toBe('Refund ₹1,000');
    expect(formatFareDifference('-250000')).toBe('Refund ₹2,500');
  });

  it('formats zero or invalid fare difference as No fare difference', () => {
    expect(formatFareDifference(0)).toBe('No fare difference');
    expect(formatFareDifference(null)).toBe('No fare difference');
    expect(formatFareDifference(undefined)).toBe('No fare difference');
    expect(formatFareDifference('')).toBe('No fare difference');
    expect(formatFareDifference(NaN)).toBe('No fare difference');
    expect(formatFareDifference('invalid')).toBe('No fare difference');
  });
});
