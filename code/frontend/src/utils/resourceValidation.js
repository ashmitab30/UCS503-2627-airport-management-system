/**
 * resourceValidation.js
 * Validation and option formatting logic for ResourceManager.
 */

/**
 * Validates the Resource Assignment form.
 *
 * @param {Object} form - { resource_id, flight_id, start_time, end_time }
 * @returns {{ isValid: boolean, errors: Object }}
 */
export function validateResourceAssignmentForm(form = {}) {
  const errors = {};

  if (!form.resource_id || !String(form.resource_id).trim()) {
    errors.resource_id = 'Resource is required';
  }

  if (!form.flight_id || !String(form.flight_id).trim()) {
    errors.flight_id = 'Flight is required';
  }

  if (!form.start_time || !String(form.start_time).trim()) {
    errors.start_time = 'Start time is required';
  }

  if (!form.end_time || !String(form.end_time).trim()) {
    errors.end_time = 'End time is required';
  }

  if (form.start_time && form.end_time) {
    const s = new Date(form.start_time).getTime();
    const e = new Date(form.end_time).getTime();
    if (isNaN(s)) {
      errors.start_time = 'Invalid start time';
    }
    if (isNaN(e)) {
      errors.end_time = 'Invalid end time';
    }
    if (!isNaN(s) && !isNaN(e) && e <= s) {
      errors.end_time = 'End time must be after start time';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export const ALLOWED_RESOURCE_TYPES = [
  'fuel_truck',
  'baggage_cart',
  'crew',
  'catering_truck',
  'pushback_tug',
];

/**
 * Validates the Add Resource form.
 *
 * @param {Object} form - { airport_id, type }
 * @returns {{ isValid: boolean, errors: Object }}
 */
export function validateAddResourceForm(form = {}) {
  const errors = {};

  if (!form.airport_id || !String(form.airport_id).trim()) {
    errors.airport_id = 'Airport is required';
  }

  if (!form.type || !String(form.type).trim()) {
    errors.type = 'Resource type is required';
  } else if (!ALLOWED_RESOURCE_TYPES.includes(form.type)) {
    errors.type = `Resource type must be one of: ${ALLOWED_RESOURCE_TYPES.join(', ')}`;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Formats a resource label for option display:
 * "Fuel truck #3 · DEL · available"
 */
export function formatResourceOption(resource, airports = []) {
  if (!resource) return '';
  const typeLabels = {
    fuel_truck: 'Fuel truck',
    baggage_cart: 'Baggage cart',
    crew: 'Crew',
    catering_truck: 'Catering truck',
    pushback_tug: 'Pushback tug',
  };
  const typeLabel = typeLabels[resource.type] || resource.type;
  const ap = Array.isArray(airports) ? airports.find((a) => a.id === resource.airport_id) : null;
  const apCode = ap ? ap.code : `#${resource.airport_id}`;
  return `${typeLabel} #${resource.id} · ${apCode} · ${resource.status}`;
}

/**
 * Determines whether a flight is still assignable (not cancelled and not departed).
 */
export function isFlightAssignable(flight, now = new Date()) {
  if (!flight) return false;
  if (['cancelled', 'departed', 'in_air', 'landed'].includes(flight.status)) {
    return false;
  }
  const depTimeVal = flight.actual_departure || flight.scheduled_departure;
  if (!depTimeVal) return false;
  const depTime = new Date(depTimeVal).getTime();
  const refTime = new Date(now).getTime();
  return depTime > refTime;
}

/**
 * Formats flight label for option display:
 * "AI-101 · DEL → BOM · 23 Nov 2026, 04:58"
 */
export function formatFlightOption(flight, formatDateTimeFn) {
  if (!flight) return '';
  const timeStr = formatDateTimeFn ? formatDateTimeFn(flight.scheduled_departure) : flight.scheduled_departure;
  return `${flight.flight_number} · ${flight.origin_code} → ${flight.dest_code} · ${timeStr}`;
}
