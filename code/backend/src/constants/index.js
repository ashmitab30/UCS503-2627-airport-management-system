// Central shared constants across the backend API

export const ALL_ROLES = ['passenger', 'ground_crew', 'security', 'medical', 'ops_manager', 'admin'];

export const STAFF_ROLES = ['admin', 'ops_manager', 'ground_crew', 'security', 'medical'];

export const ADMIN_OPS_ROLES = ['admin', 'ops_manager'];

export const ASSISTANCE_STAFF_ROLES = ['admin', 'ops_manager', 'ground_crew', 'medical'];

export const ASSISTANCE_TYPES = ['wheelchair', 'medical', 'visual', 'hearing', 'elderly_support'];

export const EMERGENCY_TYPES = ['medical', 'security', 'weather', 'technical', 'fire'];

export const ALERT_ROLES_BY_TYPE = {
  medical: ['medical', 'ops_manager', 'admin'],
  security: ['security', 'ops_manager', 'admin'],
  weather: ['ops_manager', 'admin'],
  technical: ['ground_crew', 'ops_manager', 'admin'],
  fire: ['security', 'ground_crew', 'ops_manager', 'admin'],
};

export const FLIGHT_STATUSES = [
  'scheduled',
  'boarding',
  'departed',
  'in_air',
  'landed',
  'delayed',
  'cancelled',
  'diverted',
];

export const ALLOWED_STATUS_TRANSITIONS = {
  scheduled: ['boarding', 'delayed', 'cancelled'],
  boarding: ['departed', 'delayed', 'cancelled'],
  delayed: ['scheduled', 'boarding', 'cancelled'],
  departed: ['in_air', 'diverted'],
  in_air: ['landed', 'diverted'],
  diverted: ['landed', 'cancelled'],
  landed: [],
  cancelled: [],
};

export const SEAT_CLASS_MULTIPLIERS = {
  economy: 1.0,
  premium_economy: 1.4,
  business: 2.2,
  first: 3.5,
};

// Domain keys for pg_advisory_xact_lock(key1, key2)
export const ADVISORY_LOCK_DOMAINS = {
  GATE: 1,
  EMPLOYEE: 2,
  RESOURCE: 3,
  PARKING_SLOT: 4,
  SEAT: 5,
};

