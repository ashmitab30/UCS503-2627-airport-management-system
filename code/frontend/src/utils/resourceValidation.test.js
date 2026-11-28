import { describe, it, expect } from 'vitest';
import {
  validateResourceAssignmentForm,
  validateAddResourceForm,
  formatResourceOption,
  isFlightAssignable,
  formatFlightOption,
} from './resourceValidation.js';

describe('Task 4: Resource Assignment Form Validation', () => {
  it('requires resource_id, flight_id, start_time, and end_time', () => {
    const res = validateResourceAssignmentForm({});
    expect(res.isValid).toBe(false);
    expect(res.errors.resource_id).toBe('Resource is required');
    expect(res.errors.flight_id).toBe('Flight is required');
    expect(res.errors.start_time).toBe('Start time is required');
    expect(res.errors.end_time).toBe('End time is required');
  });

  it('rejects when end_time is equal to start_time', () => {
    const res = validateResourceAssignmentForm({
      resource_id: 1,
      flight_id: 2,
      start_time: '2026-11-28T14:00',
      end_time: '2026-11-28T14:00',
    });
    expect(res.isValid).toBe(false);
    expect(res.errors.end_time).toBe('End time must be after start time');
  });

  it('rejects when end_time is before start_time', () => {
    const res = validateResourceAssignmentForm({
      resource_id: 1,
      flight_id: 2,
      start_time: '2026-11-28T15:00',
      end_time: '2026-11-28T14:00',
    });
    expect(res.isValid).toBe(false);
    expect(res.errors.end_time).toBe('End time must be after start time');
  });

  it('rejects invalid or garbage date strings', () => {
    const res = validateResourceAssignmentForm({
      resource_id: 1,
      flight_id: 2,
      start_time: 'garbage',
      end_time: '2026-11-28T16:00',
    });
    expect(res.isValid).toBe(false);
    expect(res.errors.start_time).toBe('Invalid start time');
  });

  it('passes when all fields are valid and end_time is after start_time', () => {
    const res = validateResourceAssignmentForm({
      resource_id: 5,
      flight_id: 12,
      start_time: '2026-11-28T14:00',
      end_time: '2026-11-28T16:00',
    });
    expect(res.isValid).toBe(true);
    expect(res.errors).toEqual({});
  });
});

describe('Task 4: Add Resource Form Validation', () => {
  it('requires airport_id and type', () => {
    const res = validateAddResourceForm({});
    expect(res.isValid).toBe(false);
    expect(res.errors.airport_id).toBe('Airport is required');
    expect(res.errors.type).toBe('Resource type is required');
  });

  it('passes when airport_id and type are provided', () => {
    const res = validateAddResourceForm({
      airport_id: 1,
      type: 'fuel_truck',
    });
    expect(res.isValid).toBe(true);
    expect(res.errors).toEqual({});
  });

  it('rejects unallowed types in validateAddResourceForm', () => {
    ['gate', 'baggage_carousel', 'checkin_counter', 'security_lane', 'submarine'].forEach((t) => {
      const res = validateAddResourceForm({ airport_id: 1, type: t });
      expect(res.isValid).toBe(false);
      expect(res.errors.type).toContain('Resource type must be one of');
    });
  });
});

describe('Task 4: Resource Option Formatting', () => {
  const airports = [
    { id: 1, code: 'DEL', name: 'Delhi' },
    { id: 2, code: 'BOM', name: 'Mumbai' },
  ];

  it('formats resource with type name, id, airport code, and status', () => {
    const opt = formatResourceOption(
      { id: 3, airport_id: 1, type: 'fuel_truck', status: 'available' },
      airports
    );
    expect(opt).toBe('Fuel truck #3 · DEL · available');
  });

  it('formats baggage_cart, crew, catering_truck, pushback_tug accurately', () => {
    expect(
      formatResourceOption({ id: 10, airport_id: 2, type: 'pushback_tug', status: 'maintenance' }, airports)
    ).toBe('Pushback tug #10 · BOM · maintenance');
  });
});

describe('Task 4: Flight Assignability & Option Formatting', () => {
  const now = new Date('2026-11-23T01:00:00Z');

  it('rejects cancelled flights', () => {
    const flight = {
      id: 1,
      status: 'cancelled',
      scheduled_departure: '2026-11-24T10:00:00Z',
    };
    expect(isFlightAssignable(flight, now)).toBe(false);
  });

  it('rejects departed, in_air, and landed flights', () => {
    expect(isFlightAssignable({ id: 2, status: 'departed', scheduled_departure: '2026-11-24T10:00:00Z' }, now)).toBe(false);
    expect(isFlightAssignable({ id: 3, status: 'in_air', scheduled_departure: '2026-11-24T10:00:00Z' }, now)).toBe(false);
    expect(isFlightAssignable({ id: 4, status: 'landed', scheduled_departure: '2026-11-24T10:00:00Z' }, now)).toBe(false);
  });

  it('rejects past scheduled flights', () => {
    const flight = {
      id: 5,
      status: 'scheduled',
      scheduled_departure: '2026-11-22T10:00:00Z',
    };
    expect(isFlightAssignable(flight, now)).toBe(false);
  });

  it('allows future scheduled flights', () => {
    const flight = {
      id: 6,
      status: 'scheduled',
      scheduled_departure: '2026-11-24T10:00:00Z',
    };
    expect(isFlightAssignable(flight, now)).toBe(true);
  });

  it('formats flight option as "FLIGHT_NUM · ORIGIN → DEST · DATETIME"', () => {
    const flight = {
      flight_number: 'AI-101',
      origin_code: 'DEL',
      dest_code: 'BOM',
      scheduled_departure: '2026-11-23T04:58:00Z',
    };
    const mockFormat = () => '23 Nov 2026, 04:58';
    const opt = formatFlightOption(flight, mockFormat);
    expect(opt).toBe('AI-101 · DEL → BOM · 23 Nov 2026, 04:58');
  });
});
