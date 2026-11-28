import { describe, it, expect } from 'vitest';
import {
  isDateDisabled,
  toISODateString,
  parseISODateString,
} from './DatePicker.jsx';
import {
  filterAirports,
  formatAirportOption,
} from './AirportSelect.jsx';

describe('Task 3: DatePicker Min-Date & Parsing Logic', () => {
  it('disables dates strictly before minDate when minDate is "today"', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    expect(isDateDisabled(yesterday, 'today')).toBe(true);
    expect(isDateDisabled(today, 'today')).toBe(false);
    expect(isDateDisabled(tomorrow, 'today')).toBe(false);
  });

  it('disables dates before explicit ISO string minDate', () => {
    const minDate = '2026-11-20';

    expect(isDateDisabled('2026-11-19', minDate)).toBe(true);
    expect(isDateDisabled('2026-11-20', minDate)).toBe(false);
    expect(isDateDisabled('2026-11-21', minDate)).toBe(false);
  });

  it('allows all dates when minDate is null or undefined', () => {
    expect(isDateDisabled(new Date('2020-01-01'), null)).toBe(false);
    expect(isDateDisabled(new Date('2020-01-01'), undefined)).toBe(false);
    expect(isDateDisabled(null, 'today')).toBe(false);
  });

  it('converts Date to local YYYY-MM-DD string correctly', () => {
    const d = new Date(2026, 10, 28); // Month is 0-indexed: 10 = Nov
    expect(toISODateString(d)).toBe('2026-11-28');
  });

  it('parses YYYY-MM-DD string into a valid local Date object', () => {
    const parsed = parseISODateString('2026-11-28');
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(10); // 10 = Nov
    expect(parsed.getDate()).toBe(28);
  });

  it('returns undefined when parsing invalid or empty date strings', () => {
    expect(parseISODateString('')).toBeUndefined();
    expect(parseISODateString(null)).toBeUndefined();
    expect(parseISODateString('not-a-date')).toBeUndefined();
  });
});

describe('Task 3: AirportSelect Search & Filtering Logic', () => {
  const sampleAirports = [
    { id: 1, code: 'DEL', city: 'Delhi', name: 'Indira Gandhi International Airport' },
    { id: 2, code: 'BOM', city: 'Mumbai', name: 'Chhatrapati Shivaji Maharaj International Airport' },
    { id: 3, code: 'BLR', city: 'Bengaluru', name: 'Kempegowda International Airport' },
    { id: 4, code: 'MAA', city: 'Chennai', name: 'Chennai International Airport' },
    { id: 5, code: 'GOI', city: 'Goa', name: 'Dabolim Airport' },
  ];

  it('filters airports by 3-letter IATA code case-insensitively', () => {
    const resUpper = filterAirports(sampleAirports, 'DEL');
    expect(resUpper).toHaveLength(1);
    expect(resUpper[0].code).toBe('DEL');

    const resLower = filterAirports(sampleAirports, 'maa');
    expect(resLower).toHaveLength(1);
    expect(resLower[0].code).toBe('MAA');
  });

  it('filters airports by city case-insensitively', () => {
    const res1 = filterAirports(sampleAirports, 'mumbai');
    expect(res1).toHaveLength(1);
    expect(res1[0].code).toBe('BOM');

    const res2 = filterAirports(sampleAirports, 'CHENNAI');
    expect(res2).toHaveLength(1);
    expect(res2[0].code).toBe('MAA');

    const res3 = filterAirports(sampleAirports, 'bengaluru');
    expect(res3).toHaveLength(1);
    expect(res3[0].code).toBe('BLR');
  });

  it('filters airports by airport name case-insensitively', () => {
    const res1 = filterAirports(sampleAirports, 'shivaji');
    expect(res1).toHaveLength(1);
    expect(res1[0].code).toBe('BOM');

    const res2 = filterAirports(sampleAirports, 'dabolim');
    expect(res2).toHaveLength(1);
    expect(res2[0].code).toBe('GOI');

    const res3 = filterAirports(sampleAirports, 'kempegowda');
    expect(res3).toHaveLength(1);
    expect(res3[0].code).toBe('BLR');
  });

  it('returns all airports when search query is empty or whitespace', () => {
    expect(filterAirports(sampleAirports, '')).toEqual(sampleAirports);
    expect(filterAirports(sampleAirports, '   ')).toEqual(sampleAirports);
    expect(filterAirports(sampleAirports, null)).toEqual(sampleAirports);
  });

  it('returns empty array when query does not match any airport', () => {
    const res = filterAirports(sampleAirports, 'XYZNONEXISTENT');
    expect(res).toEqual([]);
  });

  it('handles null, undefined, or empty airports array safely', () => {
    expect(filterAirports(null, 'DEL')).toEqual([]);
    expect(filterAirports(undefined, 'DEL')).toEqual([]);
    expect(filterAirports([], 'DEL')).toEqual([]);
  });

  it('formats option string as "CODE · City — Name"', () => {
    const opt = formatAirportOption({
      code: 'DEL',
      city: 'Delhi',
      name: 'Indira Gandhi International Airport',
    });
    expect(opt).toBe('DEL · Delhi — Indira Gandhi International Airport');
  });

  it('falls back to "India" if city is missing in formatAirportOption', () => {
    const opt = formatAirportOption({
      code: 'IXZ',
      city: null,
      name: 'Port Blair Airport',
    });
    expect(opt).toBe('IXZ · India — Port Blair Airport');
  });
});
