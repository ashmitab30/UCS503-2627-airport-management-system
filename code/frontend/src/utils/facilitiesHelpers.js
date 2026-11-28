export const FACILITY_TYPES = [
  'lounge',
  'restaurant',
  'shop',
  'restroom',
  'prayer_room',
  'charging_station',
];

export const FACILITY_STATUSES = ['open', 'closed'];

export const FACILITY_TYPE_CONFIG = {
  lounge: {
    label: 'Lounge',
    icon: 'weekend',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.1)',
  },
  restaurant: {
    label: 'Restaurant & Dining',
    icon: 'restaurant',
    color: '#f97316',
    bgColor: 'rgba(249, 115, 22, 0.1)',
  },
  shop: {
    label: 'Shop & Retail',
    icon: 'storefront',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.1)',
  },
  restroom: {
    label: 'Restroom & Care',
    icon: 'wc',
    color: '#06b6d4',
    bgColor: 'rgba(6, 182, 212, 0.1)',
  },
  prayer_room: {
    label: 'Prayer & Meditation',
    icon: 'self_improvement',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.1)',
  },
  charging_station: {
    label: 'Charging Station',
    icon: 'battery_charging_full',
    color: '#eab308',
    bgColor: 'rgba(234, 179, 8, 0.1)',
  },
};

export function getFacilityTypeMeta(type) {
  return (
    FACILITY_TYPE_CONFIG[type] || {
      label: type || 'Facility',
      icon: 'business',
      color: '#64748b',
      bgColor: 'rgba(100, 116, 139, 0.1)',
    }
  );
}

export function getFacilityStatusBadgeStyle(status) {
  if (status === 'open') {
    return {
      backgroundColor: 'rgba(16, 185, 129, 0.12)',
      color: '#059669',
      border: '1px solid rgba(16, 185, 129, 0.3)',
    };
  }
  return {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    color: '#dc2626',
    border: '1px solid rgba(239, 68, 68, 0.3)',
  };
}

/**
 * Validates facility creation and edit form fields.
 */
export function validateFacilityForm(formData) {
  const errors = {};

  // airport_id
  const airportId = parseInt(formData.airport_id, 10);
  if (!formData.airport_id || isNaN(airportId) || airportId <= 0) {
    errors.airport_id = 'Please select a valid airport';
  }

  // name (2-80 chars)
  const name = (formData.name || '').trim();
  if (!name) {
    errors.name = 'Facility name is required';
  } else if (name.length < 2) {
    errors.name = 'Name must be at least 2 characters';
  } else if (name.length > 80) {
    errors.name = 'Name cannot exceed 80 characters';
  }

  // type (must be in FACILITY_TYPES)
  if (!formData.type) {
    errors.type = 'Facility type is required';
  } else if (!FACILITY_TYPES.includes(formData.type)) {
    errors.type = `Type must be one of: ${FACILITY_TYPES.join(', ')}`;
  }

  // location_terminal (max 80 chars)
  const terminal = (formData.location_terminal || '').trim();
  if (terminal.length > 80) {
    errors.location_terminal = 'Terminal location cannot exceed 80 characters';
  }

  // location_gate_proximity (max 80 chars)
  const gateProx = (formData.location_gate_proximity || '').trim();
  if (gateProx.length > 80) {
    errors.location_gate_proximity = 'Gate proximity cannot exceed 80 characters';
  }

  // status
  if (formData.status && !FACILITY_STATUSES.includes(formData.status)) {
    errors.status = "Status must be 'open' or 'closed'";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Filter facilities list in-memory.
 */
export function filterFacilities(facilities, { airportId, type, status, query } = {}) {
  if (!Array.isArray(facilities)) return [];

  return facilities.filter((f) => {
    // Airport filter
    if (airportId && String(f.airport_id) !== String(airportId)) {
      return false;
    }
    // Type filter
    if (type && type !== 'all' && f.type !== type) {
      return false;
    }
    // Status filter
    if (status && status !== 'all' && f.status !== status) {
      return false;
    }
    // Search query filter (matches name, terminal, or gate proximity)
    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      const nameMatch = f.name ? f.name.toLowerCase().includes(q) : false;
      const termMatch = f.location_terminal ? f.location_terminal.toLowerCase().includes(q) : false;
      const gateMatch = f.location_gate_proximity ? f.location_gate_proximity.toLowerCase().includes(q) : false;
      if (!nameMatch && !termMatch && !gateMatch) return false;
    }
    return true;
  });
}

/**
 * Groups a list of facilities by terminal.
 * Returns an object with keys as terminal names and values as arrays of facilities.
 */
export function groupFacilitiesByTerminal(facilities) {
  if (!Array.isArray(facilities)) return {};

  const groups = {};
  for (const f of facilities) {
    const term = (f.location_terminal || '').trim() || 'General / Concourse';
    if (!groups[term]) {
      groups[term] = [];
    }
    groups[term].push(f);
  }

  // Sort facilities inside each terminal by name
  for (const term in groups) {
    groups[term].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  return groups;
}
