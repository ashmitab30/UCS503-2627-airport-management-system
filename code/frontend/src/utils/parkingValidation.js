export const INDIAN_VEHICLE_PLATE_REGEX =
  /^(?:[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/;

export const PARKING_MAX_DURATION_DAYS = 30;

/**
 * Validates an Indian vehicle registration plate.
 * Normalises whitespace and hyphens, converts to uppercase.
 * Examples: MH12AB1234, DL1CAB1234, KA05D9999, 22BH1234AA.
 */
export function validateVehiclePlate(plateString) {
  if (!plateString || typeof plateString !== 'string' || !plateString.trim()) {
    return { valid: false, error: 'Vehicle number is required' };
  }
  const cleaned = plateString.replace(/[\s-]+/g, '').toUpperCase();
  if (cleaned.length < 5) {
    return { valid: false, error: 'Vehicle number is too short (min 5 characters)' };
  }
  if (cleaned.length > 12) {
    return { valid: false, error: 'Vehicle number is too long (max 12 characters)' };
  }
  if (!INDIAN_VEHICLE_PLATE_REGEX.test(cleaned)) {
    return {
      valid: false,
      error: 'Invalid Indian plate format (e.g. MH12AB1234, DL1CAB1234)',
    };
  }
  return { valid: true, plate: cleaned };
}

/**
 * Calculates parking duration in hours (rounded UP) and total price in rupees and paise.
 */
export function calculateParkingPrice(fromString, untilString, hourlyRateRupees) {
  if (!fromString || !untilString) {
    return { valid: false, error: 'Both start and end dates are required', hours: 0, amountRupees: 0, amountPaise: 0 };
  }
  const from = new Date(fromString);
  const until = new Date(untilString);

  if (isNaN(from.getTime()) || isNaN(until.getTime())) {
    return { valid: false, error: 'Invalid date format', hours: 0, amountRupees: 0, amountPaise: 0 };
  }
  if (until.getTime() <= from.getTime()) {
    return { valid: false, error: 'End time must be after start time', hours: 0, amountRupees: 0, amountPaise: 0 };
  }

  const durationMs = until.getTime() - from.getTime();
  const maxMs = PARKING_MAX_DURATION_DAYS * 24 * 3600 * 1000;
  if (durationMs > maxMs) {
    return {
      valid: false,
      error: `Reservation cannot exceed ${PARKING_MAX_DURATION_DAYS} days`,
      hours: 0,
      amountRupees: 0,
      amountPaise: 0,
    };
  }

  const hours = Math.ceil(durationMs / (1000 * 60 * 60));
  const rate = parseFloat(hourlyRateRupees) || 0;
  const amountRupees = Number((hours * rate).toFixed(2));
  const amountPaise = Math.round(amountRupees * 100);

  return {
    valid: true,
    hours,
    amountRupees,
    amountPaise,
  };
}

/**
 * Visual badge styling based on parking booking status.
 */
export function getParkingStatusBadgeStyle(status) {
  switch (status) {
    case 'reserved':
      return {
        backgroundColor: 'rgba(2, 132, 199, 0.12)',
        color: '#0284c7',
        border: '1px solid rgba(2, 132, 199, 0.3)',
      };
    case 'active':
      return {
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        color: '#10b981',
        border: '1px solid rgba(16, 185, 129, 0.3)',
      };
    case 'completed':
      return {
        backgroundColor: 'rgba(100, 116, 139, 0.12)',
        color: '#64748b',
        border: '1px solid rgba(100, 116, 139, 0.3)',
      };
    case 'cancelled':
      return {
        backgroundColor: 'rgba(239, 68, 68, 0.12)',
        color: '#ef4444',
        border: '1px solid rgba(239, 68, 68, 0.3)',
      };
    default:
      return {
        backgroundColor: 'rgba(100, 116, 139, 0.12)',
        color: '#64748b',
        border: '1px solid rgba(100, 116, 139, 0.3)',
      };
  }
}
