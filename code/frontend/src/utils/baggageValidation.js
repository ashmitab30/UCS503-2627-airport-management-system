export const BAGGAGE_STATUSES = ['checked_in', 'loaded', 'in_transit', 'arrived', 'lost'];

export const BAGGAGE_STATUS_LABELS = {
  checked_in: 'Checked In',
  loaded: 'Loaded',
  in_transit: 'In Transit',
  arrived: 'Arrived',
  lost: 'Lost',
};

export const BAGGAGE_TRANSITIONS = {
  checked_in: ['loaded', 'lost'],
  loaded: ['in_transit', 'lost'],
  in_transit: ['arrived', 'lost'],
  arrived: [],
  lost: [],
};

export const BAGGAGE_WEIGHT_MIN = 0.1;
export const BAGGAGE_WEIGHT_MAX = 32.0;

/**
 * Validate baggage weight in kilograms (0.1 to 32.0 kg).
 */
export function validateWeight(weight) {
  if (weight === null || weight === undefined || String(weight).trim() === '') {
    return { valid: false, error: 'Weight is required' };
  }
  const numeric = parseFloat(weight);
  if (isNaN(numeric)) {
    return { valid: false, error: 'Weight must be a valid number' };
  }
  if (numeric < BAGGAGE_WEIGHT_MIN) {
    return { valid: false, error: `Weight must be at least ${BAGGAGE_WEIGHT_MIN} kg` };
  }
  if (numeric > BAGGAGE_WEIGHT_MAX) {
    return { valid: false, error: `Weight cannot exceed ${BAGGAGE_WEIGHT_MAX} kg` };
  }
  return { valid: true, numeric: Math.round(numeric * 100) / 100 };
}

/**
 * Get next allowed statuses from current status.
 */
export function getNextStatuses(currentStatus) {
  return BAGGAGE_TRANSITIONS[currentStatus] || [];
}

/**
 * Visual badge styling based on baggage status.
 */
export function getStatusBadgeStyle(status) {
  switch (status) {
    case 'checked_in':
      return {
        backgroundColor: 'rgba(2, 132, 199, 0.12)',
        color: '#0284c7',
        border: '1px solid rgba(2, 132, 199, 0.3)',
      };
    case 'loaded':
      return {
        backgroundColor: 'rgba(124, 58, 237, 0.12)',
        color: '#7c3aed',
        border: '1px solid rgba(124, 58, 237, 0.3)',
      };
    case 'in_transit':
      return {
        backgroundColor: 'rgba(217, 119, 6, 0.12)',
        color: '#d97706',
        border: '1px solid rgba(217, 119, 6, 0.3)',
      };
    case 'arrived':
      return {
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        color: '#10b981',
        border: '1px solid rgba(16, 185, 129, 0.3)',
      };
    case 'lost':
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
