/**
 * Utility functions for validating Admin Connection & Operations forms:
 * 1. Connection creation form
 * 2. Minimum Connection Time (MCT) editor
 * 3. Flight delay logging form
 */

export const DELAY_REASON_CODES = [
  { code: 'WX', label: 'Weather (WX)' },
  { code: 'TECH', label: 'Technical / Maintenance (TECH)' },
  { code: 'ATC', label: 'Air Traffic Control (ATC)' },
  { code: 'LATE_INBOUND', label: 'Late Inbound Aircraft (LATE_INBOUND)' },
  { code: 'GROUND', label: 'Ground Operations (GROUND)' },
  { code: 'SEC', label: 'Security (SEC)' },
  { code: 'CREW', label: 'Crew Scheduling / Rest (CREW)' },
];

/**
 * Validates Minimum Connection Time input.
 * Allowed: whole number integer between 15 and 240.
 */
export function validateMct(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { valid: false, error: 'MCT is required' };
  }

  const num = Number(value);
  if (isNaN(num) || !Number.isInteger(num)) {
    return { valid: false, error: 'MCT must be a whole number of minutes' };
  }

  if (num < 15) {
    return { valid: false, error: 'MCT must be at least 15 minutes' };
  }

  if (num > 240) {
    return { valid: false, error: 'MCT must not exceed 240 minutes (4 hours)' };
  }

  return { valid: true, value: num };
}

/**
 * Validates flight delay logging input.
 */
export function validateDelayForm({ flightId, delayMinutes, reasonCode } = {}) {
  const errors = {};

  if (!flightId || isNaN(Number(flightId)) || Number(flightId) <= 0) {
    errors.flightId = 'Please select a flight to delay';
  }

  if (delayMinutes === undefined || delayMinutes === null || String(delayMinutes).trim() === '') {
    errors.delayMinutes = 'Delay minutes are required';
  } else {
    const mins = Number(delayMinutes);
    if (isNaN(mins) || !Number.isInteger(mins)) {
      errors.delayMinutes = 'Delay must be a whole number of minutes';
    } else if (mins < 1) {
      errors.delayMinutes = 'Delay must be at least 1 minute';
    } else if (mins > 1440) {
      errors.delayMinutes = 'Delay cannot exceed 1440 minutes (24 hours)';
    }
  }

  const validCodes = DELAY_REASON_CODES.map((r) => r.code);
  if (!reasonCode || !validCodes.includes(reasonCode)) {
    errors.reasonCode = 'Please select a valid IATA reason code';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validates connecting itinerary creation form.
 */
export function validateConnectionForm({ passengerId, inboundBooking, outboundBooking, hubMct } = {}) {
  const errors = {};

  if (!passengerId) {
    errors.passengerId = 'Please select a passenger';
  }

  if (!inboundBooking) {
    errors.inboundBooking = 'Please select an inbound booking';
  }

  if (!outboundBooking) {
    errors.outboundBooking = 'Please select an outbound booking';
  }

  if (inboundBooking && outboundBooking) {
    if (inboundBooking.id === outboundBooking.id) {
      errors.outboundBooking = 'Inbound and outbound flights cannot be the same booking';
    }

    if (inboundBooking.status !== 'confirmed') {
      errors.inboundBooking = 'Inbound booking must be confirmed';
    }

    if (outboundBooking.status !== 'confirmed') {
      errors.outboundBooking = 'Outbound booking must be confirmed';
    }

    // Geometry check: inbound destination must equal outbound origin
    const inboundDest = inboundBooking.dest_code;
    const outboundOrig = outboundBooking.origin_code;
    if (inboundDest && outboundOrig && inboundDest !== outboundOrig) {
      errors.route = `Transfer hub mismatch: inbound flight arrives at ${inboundDest}, but outbound flight departs from ${outboundOrig}`;
    }

    // Timing check: outbound departure must be after inbound arrival
    const inArrStr = inboundBooking.estimated_arrival || inboundBooking.scheduled_arrival;
    const outDepStr = outboundBooking.estimated_departure || outboundBooking.scheduled_departure;

    if (inArrStr && outDepStr) {
      const inArr = new Date(inArrStr).getTime();
      const outDep = new Date(outDepStr).getTime();

      if (isNaN(inArr) || isNaN(outDep)) {
        errors.timing = 'Invalid flight departure or arrival timestamps';
      } else if (outDep <= inArr) {
        errors.timing = 'Outbound flight must depart after inbound flight arrives';
      }
    }
  }

  // Summary computations
  let summary = null;
  if (inboundBooking && outboundBooking && !errors.route && !errors.timing) {
    const inArrStr = inboundBooking.estimated_arrival || inboundBooking.scheduled_arrival;
    const outDepStr = outboundBooking.estimated_departure || outboundBooking.scheduled_departure;
    const inArr = new Date(inArrStr).getTime();
    const outDep = new Date(outDepStr).getTime();

    const layoverMinutes = Math.round((outDep - inArr) / 60000);
    const mct = Number(hubMct || inboundBooking.dest_mct || 60);
    const deficit = mct - layoverMinutes;

    summary = {
      route: `${inboundBooking.origin_code} → ${inboundBooking.dest_code} → ${outboundBooking.dest_code}`,
      hubCode: inboundBooking.dest_code,
      inboundFlight: inboundBooking.flight_number,
      outboundFlight: outboundBooking.flight_number,
      layoverMinutes,
      mct,
      deficit,
      isAtRisk: deficit > 0,
    };
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    summary,
  };
}

/**
 * Finds all partner bookings from allBookings that form a valid connecting itinerary with sourceBooking.
 *
 * Requirements:
 * - Both bookings confirmed, not cancelled, not departed.
 * - Neither booking already linked in existingConnections.
 * - Same passenger.
 * - Either sourceBooking is inbound and partner is outbound (source.dest_code === partner.origin_code && dep(partner) > arr(source))
 *   OR partner is inbound and sourceBooking is outbound (partner.dest_code === source.origin_code && dep(source) > arr(partner))
 * - Computes route, flight numbers, dates, layover minutes, and hub MCT.
 */
export function findValidConnectionPartners(sourceBooking, allBookings = [], airports = [], existingConnections = []) {
  if (!sourceBooking || sourceBooking.status !== 'confirmed') return [];
  if (sourceBooking.flight_status === 'cancelled' || sourceBooking.flight_status === 'departed') return [];

  // Track already linked bookings
  const linkedIds = new Set();
  for (const c of existingConnections) {
    if (c.inbound_booking_id) linkedIds.add(c.inbound_booking_id);
    if (c.outbound_booking_id) linkedIds.add(c.outbound_booking_id);
  }

  if (linkedIds.has(sourceBooking.id)) return [];

  const partners = [];

  for (const b of allBookings) {
    if (!b || b.id === sourceBooking.id) continue;
    if (b.status !== 'confirmed') continue;
    if (b.flight_status === 'cancelled' || b.flight_status === 'departed') continue;
    if (linkedIds.has(b.id)) continue;

    const bArrStr = b.estimated_arrival || b.scheduled_arrival;
    const bDepStr = b.estimated_departure || b.scheduled_departure;
    const sArrStr = sourceBooking.estimated_arrival || sourceBooking.scheduled_arrival;
    const sDepStr = sourceBooking.estimated_departure || sourceBooking.scheduled_departure;

    const bArr = bArrStr ? new Date(bArrStr).getTime() : NaN;
    const bDep = bDepStr ? new Date(bDepStr).getTime() : NaN;
    const sArr = sArrStr ? new Date(sArrStr).getTime() : NaN;
    const sDep = sDepStr ? new Date(sDepStr).getTime() : NaN;

    // Check Case A: sourceBooking is Inbound, b is Outbound
    if (sourceBooking.dest_code && b.origin_code && sourceBooking.dest_code === b.origin_code) {
      if (!isNaN(sArr) && !isNaN(bDep) && bDep > sArr) {
        const hubCode = sourceBooking.dest_code;
        const airport = airports.find((a) => a.code === hubCode || a.id === sourceBooking.dest_id);
        const hubMct = airport?.min_connection_minutes || sourceBooking.dest_mct || 60;
        const layoverMinutes = Math.round((bDep - sArr) / 60000);
        partners.push({
          partnerBooking: b,
          inboundBooking: sourceBooking,
          outboundBooking: b,
          isSourceInbound: true,
          hubCode,
          hubMct,
          layoverMinutes,
          route: `${sourceBooking.origin_code} → ${hubCode} → ${b.dest_code}`,
          inboundFlight: sourceBooking.flight_number,
          outboundFlight: b.flight_number,
          layoverDeficit: hubMct - layoverMinutes,
          isAtRisk: layoverMinutes < hubMct,
        });
        continue;
      }
    }

    // Check Case B: b is Inbound, sourceBooking is Outbound
    if (b.dest_code && sourceBooking.origin_code && b.dest_code === sourceBooking.origin_code) {
      if (!isNaN(bArr) && !isNaN(sDep) && sDep > bArr) {
        const hubCode = b.dest_code;
        const airport = airports.find((a) => a.code === hubCode || a.id === b.dest_id);
        const hubMct = airport?.min_connection_minutes || b.dest_mct || 60;
        const layoverMinutes = Math.round((sDep - bArr) / 60000);
        partners.push({
          partnerBooking: b,
          inboundBooking: b,
          outboundBooking: sourceBooking,
          isSourceInbound: false,
          hubCode,
          hubMct,
          layoverMinutes,
          route: `${b.origin_code} → ${hubCode} → ${sourceBooking.dest_code}`,
          inboundFlight: b.flight_number,
          outboundFlight: sourceBooking.flight_number,
          layoverDeficit: hubMct - layoverMinutes,
          isAtRisk: layoverMinutes < hubMct,
        });
      }
    }
  }

  return partners;
}
