import { describe, it, expect } from 'vitest';
import {
  validateMct,
  validateDelayForm,
  validateConnectionForm,
  findValidConnectionPartners,
  DELAY_REASON_CODES,
} from './connectionValidation.js';

describe('Task 6B: Admin Connection & Ops Form Validation Tests', () => {
  describe('validateMct', () => {
    it('rejects empty, null or undefined input', () => {
      expect(validateMct('')).toEqual({ valid: false, error: 'MCT is required' });
      expect(validateMct(null)).toEqual({ valid: false, error: 'MCT is required' });
      expect(validateMct(undefined)).toEqual({ valid: false, error: 'MCT is required' });
    });

    it('rejects non-integer and NaN values', () => {
      expect(validateMct('abc')).toEqual({ valid: false, error: 'MCT must be a whole number of minutes' });
      expect(validateMct(45.5)).toEqual({ valid: false, error: 'MCT must be a whole number of minutes' });
      expect(validateMct('60.2')).toEqual({ valid: false, error: 'MCT must be a whole number of minutes' });
    });

    it('rejects values below 15 minutes', () => {
      expect(validateMct(14)).toEqual({ valid: false, error: 'MCT must be at least 15 minutes' });
      expect(validateMct(0)).toEqual({ valid: false, error: 'MCT must be at least 15 minutes' });
      expect(validateMct(-5)).toEqual({ valid: false, error: 'MCT must be at least 15 minutes' });
    });

    it('rejects values above 240 minutes', () => {
      expect(validateMct(241)).toEqual({ valid: false, error: 'MCT must not exceed 240 minutes (4 hours)' });
      expect(validateMct(500)).toEqual({ valid: false, error: 'MCT must not exceed 240 minutes (4 hours)' });
    });

    it('accepts valid whole number minutes between 15 and 240', () => {
      expect(validateMct(15)).toEqual({ valid: true, value: 15 });
      expect(validateMct('45')).toEqual({ valid: true, value: 45 });
      expect(validateMct(60)).toEqual({ valid: true, value: 60 });
      expect(validateMct(240)).toEqual({ valid: true, value: 240 });
    });
  });

  describe('validateDelayForm', () => {
    it('requires a valid positive flight ID', () => {
      const res = validateDelayForm({ flightId: null, delayMinutes: 30, reasonCode: 'WX' });
      expect(res.valid).toBe(false);
      expect(res.errors.flightId).toBe('Please select a flight to delay');
    });

    it('requires delay minutes to be a positive integer <= 1440', () => {
      expect(validateDelayForm({ flightId: 1, delayMinutes: '', reasonCode: 'WX' }).errors.delayMinutes).toBe(
        'Delay minutes are required'
      );
      expect(validateDelayForm({ flightId: 1, delayMinutes: 0, reasonCode: 'WX' }).errors.delayMinutes).toBe(
        'Delay must be at least 1 minute'
      );
      expect(validateDelayForm({ flightId: 1, delayMinutes: 25.5, reasonCode: 'WX' }).errors.delayMinutes).toBe(
        'Delay must be a whole number of minutes'
      );
      expect(validateDelayForm({ flightId: 1, delayMinutes: 1500, reasonCode: 'WX' }).errors.delayMinutes).toBe(
        'Delay cannot exceed 1440 minutes (24 hours)'
      );
    });

    it('validates IATA reason codes against allowed enum', () => {
      expect(validateDelayForm({ flightId: 1, delayMinutes: 30, reasonCode: '' }).errors.reasonCode).toBe(
        'Please select a valid IATA reason code'
      );
      expect(validateDelayForm({ flightId: 1, delayMinutes: 30, reasonCode: 'INVALID' }).errors.reasonCode).toBe(
        'Please select a valid IATA reason code'
      );

      for (const item of DELAY_REASON_CODES) {
        const res = validateDelayForm({ flightId: 1, delayMinutes: 30, reasonCode: item.code });
        expect(res.valid).toBe(true);
        expect(res.errors).toEqual({});
      }
    });
  });

  describe('validateConnectionForm', () => {
    const validInbound = {
      id: 101,
      flight_id: 1,
      flight_number: 'AI-101',
      origin_code: 'DEL',
      dest_code: 'BOM',
      dest_mct: 45,
      scheduled_departure: '2026-11-25T10:00:00Z',
      scheduled_arrival: '2026-11-25T12:00:00Z',
      status: 'confirmed',
    };

    const validOutbound = {
      id: 102,
      flight_id: 2,
      flight_number: '6E-202',
      origin_code: 'BOM',
      dest_code: 'BLR',
      scheduled_departure: '2026-11-25T14:00:00Z',
      scheduled_arrival: '2026-11-25T16:00:00Z',
      status: 'confirmed',
    };

    it('requires a passenger to be selected', () => {
      const res = validateConnectionForm({
        passengerId: null,
        inboundBooking: validInbound,
        outboundBooking: validOutbound,
      });
      expect(res.valid).toBe(false);
      expect(res.errors.passengerId).toBe('Please select a passenger');
    });

    it('requires both inbound and outbound bookings', () => {
      const res1 = validateConnectionForm({ passengerId: 1, inboundBooking: null, outboundBooking: validOutbound });
      expect(res1.valid).toBe(false);
      expect(res1.errors.inboundBooking).toBe('Please select an inbound booking');

      const res2 = validateConnectionForm({ passengerId: 1, inboundBooking: validInbound, outboundBooking: null });
      expect(res2.valid).toBe(false);
      expect(res2.errors.outboundBooking).toBe('Please select an outbound booking');
    });

    it('rejects selecting the same booking for inbound and outbound', () => {
      const res = validateConnectionForm({
        passengerId: 1,
        inboundBooking: validInbound,
        outboundBooking: validInbound,
      });
      expect(res.valid).toBe(false);
      expect(res.errors.outboundBooking).toBe('Inbound and outbound flights cannot be the same booking');
    });

    it('rejects unconfirmed bookings', () => {
      const pendingInbound = { ...validInbound, status: 'held' };
      const res = validateConnectionForm({
        passengerId: 1,
        inboundBooking: pendingInbound,
        outboundBooking: validOutbound,
      });
      expect(res.valid).toBe(false);
      expect(res.errors.inboundBooking).toBe('Inbound booking must be confirmed');
    });

    it('detects route mismatch where inbound destination != outbound origin', () => {
      const mismatchedOutbound = {
        ...validOutbound,
        origin_code: 'BLR',
        dest_code: 'MAA',
      };
      const res = validateConnectionForm({
        passengerId: 1,
        inboundBooking: validInbound, // arrives at BOM
        outboundBooking: mismatchedOutbound, // departs from BLR
      });
      expect(res.valid).toBe(false);
      expect(res.errors.route).toContain('Transfer hub mismatch');
    });

    it('detects timing conflict when outbound flight departs before or at inbound arrival', () => {
      const earlyOutbound = {
        ...validOutbound,
        scheduled_departure: '2026-11-25T11:30:00Z', // Inbound arrives at 12:00:00Z
      };
      const res = validateConnectionForm({
        passengerId: 1,
        inboundBooking: validInbound,
        outboundBooking: earlyOutbound,
      });
      expect(res.valid).toBe(false);
      expect(res.errors.timing).toBe('Outbound flight must depart after inbound flight arrives');
    });

    it('accepts valid itinerary and computes layover and buffer summary', () => {
      const res = validateConnectionForm({
        passengerId: 1,
        inboundBooking: validInbound, // arrives 12:00
        outboundBooking: validOutbound, // departs 14:00 (120m layover)
        hubMct: 45,
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual({});
      expect(res.summary).toEqual({
        route: 'DEL → BOM → BLR',
        hubCode: 'BOM',
        inboundFlight: 'AI-101',
        outboundFlight: '6E-202',
        layoverMinutes: 120,
        mct: 45,
        deficit: -75, // 75m safe buffer
        isAtRisk: false,
      });
    });

    it('flags layover deficit (isAtRisk = true) when layover is below MCT', () => {
      const tightOutbound = {
        ...validOutbound,
        scheduled_departure: '2026-11-25T12:30:00Z', // 30m layover vs 45m MCT
      };
      const res = validateConnectionForm({
        passengerId: 1,
        inboundBooking: validInbound,
        outboundBooking: tightOutbound,
        hubMct: 45,
      });
      expect(res.valid).toBe(true);
      expect(res.summary.layoverMinutes).toBe(30);
      expect(res.summary.mct).toBe(45);
      expect(res.summary.deficit).toBe(15);
      expect(res.summary.isAtRisk).toBe(true);
    });
  });

  describe('findValidConnectionPartners', () => {
    const airports = [
      { id: 1, code: 'DEL', min_connection_minutes: 60 },
      { id: 2, code: 'BOM', min_connection_minutes: 45 },
      { id: 3, code: 'BLR', min_connection_minutes: 40 },
    ];

    const sourceInbound = {
      id: 101,
      booking_ref: 'BK-101',
      origin_code: 'DEL',
      dest_code: 'BOM',
      dest_id: 2,
      flight_number: 'AI-101',
      scheduled_departure: '2026-11-25T10:00:00Z',
      scheduled_arrival: '2026-11-25T12:00:00Z',
      status: 'confirmed',
    };

    const validPartnerOutbound = {
      id: 202,
      booking_ref: 'BK-202',
      origin_code: 'BOM',
      dest_code: 'BLR',
      flight_number: '6E-202',
      scheduled_departure: '2026-11-25T14:00:00Z',
      scheduled_arrival: '2026-11-25T16:00:00Z',
      status: 'confirmed',
    };

    const mismatchPartner = {
      id: 303,
      booking_ref: 'BK-303',
      origin_code: 'DEL', // Not BOM!
      dest_code: 'BLR',
      flight_number: '6E-303',
      scheduled_departure: '2026-11-25T15:00:00Z',
      status: 'confirmed',
    };

    const priorDeparturePartner = {
      id: 404,
      booking_ref: 'BK-404',
      origin_code: 'BOM',
      dest_code: 'BLR',
      flight_number: '6E-404',
      scheduled_departure: '2026-11-25T11:00:00Z', // Before 12:00 arrival
      status: 'confirmed',
    };

    it('returns valid partner when source is inbound and partner is outbound', () => {
      const partners = findValidConnectionPartners(
        sourceInbound,
        [sourceInbound, validPartnerOutbound, mismatchPartner, priorDeparturePartner],
        airports,
        []
      );

      expect(partners).toHaveLength(1);
      expect(partners[0].partnerBooking.id).toBe(202);
      expect(partners[0].route).toBe('DEL → BOM → BLR');
      expect(partners[0].hubCode).toBe('BOM');
      expect(partners[0].hubMct).toBe(45);
      expect(partners[0].layoverMinutes).toBe(120);
      expect(partners[0].isAtRisk).toBe(false);
    });

    it('returns valid partner when source is outbound and partner is inbound', () => {
      const partners = findValidConnectionPartners(
        validPartnerOutbound,
        [sourceInbound, validPartnerOutbound],
        airports,
        []
      );

      expect(partners).toHaveLength(1);
      expect(partners[0].partnerBooking.id).toBe(101);
      expect(partners[0].route).toBe('DEL → BOM → BLR');
      expect(partners[0].isSourceInbound).toBe(false);
    });

    it('excludes bookings already linked in existingConnections', () => {
      const existingConns = [{ id: 1, inbound_booking_id: 101, outbound_booking_id: 202 }];
      const partners = findValidConnectionPartners(
        sourceInbound,
        [sourceInbound, validPartnerOutbound],
        airports,
        existingConns
      );
      expect(partners).toHaveLength(0);
    });

    it('excludes unconfirmed or cancelled bookings', () => {
      const cancelledPartner = {
        ...validPartnerOutbound,
        id: 505,
        status: 'cancelled',
      };
      const departedSource = {
        ...sourceInbound,
        flight_status: 'departed',
      };

      expect(findValidConnectionPartners(sourceInbound, [cancelledPartner], airports, [])).toHaveLength(0);
      expect(findValidConnectionPartners(departedSource, [validPartnerOutbound], airports, [])).toHaveLength(0);
    });
  });
});
