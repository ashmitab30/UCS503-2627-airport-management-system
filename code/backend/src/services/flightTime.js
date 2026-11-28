import {
  CHECK_IN_OPEN_HOURS_BEFORE_DEPARTURE,
  CHECK_IN_CLOSE_MINUTES_BEFORE_DEPARTURE,
} from '../constants/index.js';

/**
 * flightTime.js — Shared flight timing and departure evaluation service.
 *
 * Server-side source of truth for determining whether a flight has departed
 * and whether operations like check-in or booking are permitted.
 */

/**
 * Determines whether a flight has already departed relative to a reference time.
 *
 * Rule: Uses actual_departure ?? estimated_departure ?? scheduled_departure.
 * A flight with status in (delayed, scheduled, boarding) and no actual_departure
 * must NOT count as departed just because the scheduled time passed.
 * An explicit departed/in_air/landed status also indicates departure.
 *
 * @param {Object} flight - Flight object containing departure timestamps and status.
 * @param {Date|string|number} [now=new Date()] - Reference time (default: current time).
 * @returns {boolean} True if the flight has departed.
 */
export function hasDeparted(flight, now = new Date()) {
  if (!flight) return false;

  const status = flight.status || flight.flight_status;
  if (['departed', 'in_air', 'landed'].includes(status)) {
    return true;
  }

  // A flight with status in (delayed, scheduled, boarding) and no actual_departure
  // must NOT count as departed just because the scheduled time passed.
  const depTimeVal = flight.actual_departure ?? flight.estimated_departure ?? flight.scheduled_departure;
  if (!depTimeVal) return false;

  const depTime = new Date(depTimeVal).getTime();
  if (isNaN(depTime)) return false;

  const refTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (isNaN(refTime)) return false;

  if (['delayed', 'boarding'].includes(status) && !flight.actual_departure) {
    if (flight.estimated_departure) {
      return new Date(flight.estimated_departure).getTime() <= refTime;
    }
    return false;
  }

  if (status === 'scheduled' && !flight.actual_departure && flight.estimated_departure) {
    return new Date(flight.estimated_departure).getTime() <= refTime;
  }

  return depTime <= refTime;
}

/**
 * Checks whether web check-in is currently open for a flight:
 * - Must not have departed.
 * - Flight must not be cancelled.
 * - Must be within 24 hours of scheduled departure.
 * - Closes 60 minutes before (estimated) departure.
 *
 * @param {Object} flight
 * @param {Date|string|number} [now=new Date()]
 * @returns {{ allowed: boolean, reason?: string, code?: string }}
 */
export function isCheckInAllowed(flight, now = new Date()) {
  if (!flight) {
    return { allowed: false, reason: 'Flight not found', code: 'FLIGHT_NOT_FOUND' };
  }

  const status = flight.status || flight.flight_status;
  if (status === 'cancelled') {
    return { allowed: false, reason: 'Flight is cancelled', code: 'FLIGHT_CANCELLED' };
  }

  if (hasDeparted(flight, now)) {
    return { allowed: false, reason: 'Flight has already departed', code: 'FLIGHT_DEPARTED' };
  }

  const schedTimeVal = flight.scheduled_departure;
  if (!schedTimeVal) {
    return { allowed: false, reason: 'Missing scheduled departure', code: 'INVALID_SCHEDULE' };
  }

  const schedTime = new Date(schedTimeVal).getTime();
  const refTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const diffHours = (schedTime - refTime) / (1000 * 3600);

  if (diffHours > CHECK_IN_OPEN_HOURS_BEFORE_DEPARTURE) {
    return {
      allowed: false,
      reason: `Web check-in opens ${CHECK_IN_OPEN_HOURS_BEFORE_DEPARTURE} hours before scheduled departure`,
      code: 'CHECK_IN_NOT_OPEN',
    };
  }

  // Check-in closes 60 minutes before (estimated) departure
  const depTimeVal = flight.estimated_departure ?? flight.scheduled_departure;
  const depTime = new Date(depTimeVal).getTime();
  const diffMinutes = (depTime - refTime) / (1000 * 60);

  if (diffMinutes < CHECK_IN_CLOSE_MINUTES_BEFORE_DEPARTURE) {
    return {
      allowed: false,
      reason: `Check-in closes ${CHECK_IN_CLOSE_MINUTES_BEFORE_DEPARTURE} minutes before departure`,
      code: 'CHECK_IN_CLOSED',
    };
  }

  return { allowed: true };
}
