// Central shared constants across the backend API

export const ALL_ROLES = ['passenger', 'ground_crew', 'security', 'medical', 'ops_manager', 'admin'];

export const STAFF_ROLES = ['admin', 'ops_manager', 'ground_crew', 'security', 'medical'];

export const ADMIN_OPS_ROLES = ['admin', 'ops_manager'];

export const ASSISTANCE_STAFF_ROLES = ['admin', 'ops_manager', 'ground_crew', 'medical'];

export const ASSISTANCE_TYPES = ['wheelchair', 'medical', 'visual', 'hearing', 'elderly_support'];

export const ASSISTANCE_STATUSES = ['requested', 'assigned', 'in_progress', 'completed', 'cancelled'];

export const OPEN_ASSISTANCE_STATUSES = ['requested', 'assigned', 'in_progress'];

export const ASSISTANCE_TRANSITIONS = {
  requested: ['assigned', 'cancelled'],
  assigned: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
};

// Boarding Groups
// ASSUMPTION: Group 1 = priority boarding for passengers who have ANY assistance request
// that is not cancelled (status in requested, assigned, in_progress, completed) or who booked/flew
// in business or first class; Group 2 = everyone else (economy / premium_economy without assistance).
// Only cancelling the passenger's last open request while in 'requested' status can remove priority.
// A booking that is already boarded keeps its group; never recompute it.
export const BOARDING_GROUPS = {
  PRIORITY: 1,
  GENERAL: 2,
};

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

// Baggage management constants
export const BAGGAGE_STATUSES = ['checked_in', 'loaded', 'in_transit', 'arrived', 'lost'];

export const BAGGAGE_STAFF_ROLES = ['ground_crew', 'ops_manager', 'admin'];

export const BAGGAGE_TRANSITIONS = {
  checked_in: ['loaded', 'lost'],
  loaded: ['in_transit', 'lost'],
  in_transit: ['arrived', 'lost'],
  arrived: [],
  lost: [],
};

export const BAGGAGE_WEIGHT_MIN = 0.1;
export const BAGGAGE_WEIGHT_MAX = 32.0;
export const MAX_BAGS_PER_BOOKING = 3;

// Parking management constants
export const PARKING_MAX_DURATION_DAYS = 30;
export const PARKING_BOOKING_STATUSES = ['reserved', 'active', 'completed', 'cancelled'];
export const PARKING_SLOT_STATUSES = ['free', 'occupied', 'reserved'];
export const INDIAN_VEHICLE_PLATE_REGEX = /^(?:[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/;

// Facilities management constants
export const FACILITY_TYPES = [
  'lounge',
  'restaurant',
  'shop',
  'restroom',
  'prayer_room',
  'charging_station',
];
export const FACILITY_STATUSES = ['open', 'closed'];
export const FACILITY_STAFF_ROLES = ['admin', 'ops_manager', 'ground_crew'];

// Chatbot & Support constants
export const CHAT_SESSION_STATUSES = ['active', 'escalated', 'assigned', 'closed'];
export const CHAT_MESSAGE_SENDERS = ['user', 'bot', 'agent'];
export const SUPPORT_AGENT_ROLES = ['ground_crew', 'ops_manager', 'admin'];

// Flight timing & check-in window constants
export const CHECK_IN_OPEN_HOURS_BEFORE_DEPARTURE = 24;
export const CHECK_IN_CLOSE_MINUTES_BEFORE_DEPARTURE = 60;



