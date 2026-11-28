/**
 * Table-driven intent engine and entity extraction for Meridian Airport Assistant.
 * Pure module with documented priorities and deterministic pattern matching.
 */

export const AIRPORT_ENTITY_MAP = {
  DEL: 'DEL',
  DELHI: 'DEL',
  'NEW DELHI': 'DEL',
  BOM: 'BOM',
  MUMBAI: 'BOM',
  BOMBAY: 'BOM',
  BLR: 'BLR',
  BANGALORE: 'BLR',
  BENGALURU: 'BLR',
  MAA: 'MAA',
  CHENNAI: 'MAA',
  MADRAS: 'MAA',
  HYD: 'HYD',
  HYDERABAD: 'HYD',
  CCU: 'CCU',
  KOLKATA: 'CCU',
  CALCUTTA: 'CCU',
  GOI: 'GOI',
  GOA: 'GOI',
  DABOLIM: 'GOI',
  AMD: 'AMD',
  AHMEDABAD: 'AMD',
  PNQ: 'PNQ',
  PUNE: 'PNQ',
  COK: 'COK',
  KOCHI: 'COK',
  COCHIN: 'COK',
  JAI: 'JAI',
  JAIPUR: 'JAI',
};

export const FACILITY_TYPE_MAP = {
  lounge: 'lounge',
  lounges: 'lounge',
  restaurant: 'restaurant',
  restaurants: 'restaurant',
  dining: 'restaurant',
  food: 'restaurant',
  eat: 'restaurant',
  cafe: 'restaurant',
  coffee: 'restaurant',
  bistro: 'restaurant',
  snack: 'restaurant',
  snacks: 'restaurant',
  shop: 'shop',
  shops: 'shop',
  retail: 'shop',
  store: 'shop',
  stores: 'shop',
  shopping: 'shop',
  'duty free': 'shop',
  dutyfree: 'shop',
  restroom: 'restroom',
  restrooms: 'restroom',
  washroom: 'restroom',
  washrooms: 'restroom',
  toilet: 'restroom',
  toilets: 'restroom',
  bathroom: 'restroom',
  bathrooms: 'restroom',
  shower: 'restroom',
  showers: 'restroom',
  prayer_room: 'prayer_room',
  prayer: 'prayer_room',
  prayers: 'prayer_room',
  meditation: 'prayer_room',
  mosque: 'prayer_room',
  charging_station: 'charging_station',
  charging: 'charging_station',
  charger: 'charging_station',
  chargers: 'charging_station',
  power: 'charging_station',
  battery: 'charging_station',
};

/**
 * Extracts entities (flight number, booking reference, 10-digit baggage tag,
 * airport code, and facility type) from user text.
 */
export function extractEntities(text) {
  if (!text || typeof text !== 'string') {
    return {
      flightNumber: null,
      bookingRef: null,
      baggageTag: null,
      airportCode: null,
      facilityType: null,
    };
  }

  const cleanText = text.trim();

  // 1. Flight Number: AI-101, 6E-202, AI101, 6E202, UK-810, AI 101, 6E 303
  let flightNumber = null;
  const flightMatch = cleanText.match(/\b([A-Za-z]{2}|[A-Za-z]\d|\d[A-Za-z])[\s-]?([0-9]{3,4})\b/);
  if (flightMatch) {
    const code = flightMatch[1].toUpperCase();
    const num = flightMatch[2];
    flightNumber = `${code}-${num}`;
  }

  // 2. Booking Reference: BK-IN101, BK-12345, BKLINK101, BK771
  let bookingRef = null;
  const bkMatch = cleanText.match(/\b(BK[-_]?[A-Za-z0-9]{3,12})\b/i);
  if (bkMatch) {
    bookingRef = bkMatch[1].toUpperCase().replace('_', '-');
    if (!bookingRef.includes('-') && bookingRef.length > 2) {
      bookingRef = `BK-${bookingRef.slice(2)}`;
    }
  }

  // 3. 10-digit baggage tag: 1000000001, TAG-1000000001
  let baggageTag = null;
  const tagMatch = cleanText.match(/(?:TAG[-_]?)?\b(\d{10})\b/i);
  if (tagMatch) {
    baggageTag = tagMatch[1];
  }

  // 4. Airport Code or City: DEL, BOM, BLR, Delhi, Mumbai, Bengaluru...
  let airportCode = null;
  const words = cleanText.toUpperCase().split(/[^A-Z0-9]+/);
  for (const word of words) {
    if (word && AIRPORT_ENTITY_MAP[word]) {
      airportCode = AIRPORT_ENTITY_MAP[word];
      break;
    }
  }
  if (!airportCode) {
    // Check 2-word cities like "New Delhi"
    for (const [key, code] of Object.entries(AIRPORT_ENTITY_MAP)) {
      if (key.includes(' ') && cleanText.toUpperCase().includes(key)) {
        airportCode = code;
        break;
      }
    }
  }

  // 5. Facility Type
  let facilityType = null;
  const lowerText = cleanText.toLowerCase();
  for (const [keyword, mappedType] of Object.entries(FACILITY_TYPE_MAP)) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(lowerText)) {
      facilityType = mappedType;
      break;
    }
  }

  return {
    flightNumber,
    bookingRef,
    baggageTag,
    airportCode,
    facilityType,
  };
}

/**
 * Table-driven list of intents in strict order of evaluation priority.
 */
export const INTENTS_CONFIG = [
  // Priority 1: Human Agent Escalation
  {
    name: 'human_agent',
    priority: 1,
    description: 'User explicitly requests to speak with a human agent, person, or representative.',
    patterns: [
      /\b(?:talk|speak|connect|transfer|reach|chat)\s*(?:to|with)?\s*(?:a\s*)?(?:support\s*)?(?:human|person|agent|representative|operator|staff|team|someone|real\s*person)\b/i,
      /\b(?:human\s*agent|customer\s*(?:service|support|care)|real\s*person|live\s*agent|support\s*person|support\s*staff)\b/i,
      /\b(?:representative|talk\s*to\s*someone|speak\s*to\s*someone|human\s*support)\b/i,
      /\b(?:agent|operator)\b/i,
    ],
  },

  // Priority 2: Boarding Group
  {
    name: 'boarding_group',
    priority: 2,
    description: 'Inquires about boarding group (Group 1 Priority vs Group 2 General).',
    patterns: [
      /\b(?:boarding\s*group|my\s*group|priority\s*boarding|board\s*first|which\s*group|what\s*group)\b/i,
      /\b(?:when\s*(?:do\s*i|can\s*i)\s*board|boarding\s*order|boarding\s*sequence)\b/i,
    ],
  },

  // Priority 3: Check-in Status
  {
    name: 'check_in_status',
    priority: 3,
    description: 'Inquires whether web check-in is open or checks check-in status for a booking.',
    patterns: [
      /\b(?:check[- ]?in\s*(?:open|status|available|done|time)?|can\s*i\s*check[- ]?in|how\s*to\s*check[- ]?in|web\s*check[- ]?in)\b/i,
      /\b(?:is\s*check[- ]?in\s*open|checkin)\b/i,
    ],
  },

  // Priority 4: Connection Status
  {
    name: 'connection_status',
    priority: 4,
    description: 'Inquires about connecting flights, layover safety, minimum connection time, or missed connection.',
    patterns: [
      /\b(?:connection|connecting\s*flight|layover|transit|transfer\s*flight|at[- ]?risk|missed\s*connection|minimum\s*connection\s*time|mct)\b/i,
      /\b(?:will\s*i\s*make\s*(?:it|my\s*flight|my\s*connection)|tight\s*layover)\b/i,
    ],
  },

  // Priority 5: Assistance Status
  {
    name: 'assistance_status',
    priority: 5,
    description: 'Inquires about special passenger assistance requests (wheelchair, medical, visual/hearing aid).',
    patterns: [
      /\b(?:wheelchair|special\s*assistance|mobility\s*assistance|elderly\s*support|medical\s*assistance)\b/i,
      /\b(?:assistance\s*(?:request|status|help)|booked\s*wheelchair)\b/i,
    ],
  },

  // Priority 6: Baggage Status
  {
    name: 'baggage_status',
    priority: 6,
    description: 'Inquires about checked baggage status, location, tag tracking, or baggage claim.',
    patterns: [
      /\b(?:baggage|luggage|suitcase|bags?|checked\s*bag|lost\s*bag|claim\s*tag|bag\s*status)\b/i,
      /(?:tag[-_]?)?\b\d{10}\b/i,
      /\b(?:where\s*is\s*my\s*bag|track\s*my\s*bag)\b/i,
    ],
  },

  // Priority 7: My Next Flight
  {
    name: 'my_next_flight',
    priority: 7,
    description: 'Inquires about the passenger’s own upcoming flight schedule, booking, or departure.',
    patterns: [
      /\b(?:(?:my\s*)?(?:next|upcoming|scheduled)\s*flight(?:\s*departure)?|when\s*(?:do\s*i|is\s*my)\s*fl(?:y|ight)|my\s*departure|my\s*booking)\b/i,
      /\b(?:what\s*is\s*my\s*flight|next\s*flight)\b/i,
    ],
  },

  // Priority 8: Gate Information
  {
    name: 'gate_info',
    priority: 8,
    description: 'Inquires about departure gate number, gate change, or gate location.',
    patterns: [
      /\b(?:which\s*gate|what\s*gate|gate\s*(?:number|location|info)?|where\s*is\s*gate)\b/i,
      /\b(?:gate\s*for\s*(?:flight\s*)?(?:[A-Za-z]{2}|[A-Za-z]\d|\d[A-Za-z])[\s-]?[0-9]{3,4})\b/i,
    ],
  },

  // Priority 9: Flight Status
  {
    name: 'flight_status',
    priority: 9,
    description: 'Public inquiry regarding flight status, delay, arrival/departure time by flight number.',
    patterns: [
      /\b(?:flight\s*status|status\s*of\s*(?:flight)?|is\s*(?:flight)?\s*(?:[A-Za-z]{2}|[A-Za-z]\d|\d[A-Za-z])[\s-]?[0-9]{3,4}\s*(?:on\s*time|delayed|cancelled))\b/i,
      /\b(?:track\s*(?:flight)?|delay\s*on\s*(?:flight)?)\b/i,
      /\b(?:[A-Za-z]{2}|[A-Za-z]\d|\d[A-Za-z])[\s-]?[0-9]{3,4}\b/i,
    ],
  },

  // Priority 10: Parking Info
  {
    name: 'parking_info',
    priority: 10,
    description: 'Inquires about airport parking lots, hourly rates, free slots, or user parking reservations.',
    patterns: [
      /\b(?:parking|park\s*my\s*car|parking\s*rate|parking\s*slot|parking\s*fee|vehicle\s*parking)\b/i,
      /\b(?:car\s*park|parking\s*lot|parking\s*booking)\b/i,
    ],
  },

  // Priority 11: Airport Facilities
  {
    name: 'facilities',
    priority: 11,
    description: 'Inquires about airport amenities: lounges, dining, shops, restrooms, prayer rooms, charging stations.',
    patterns: [
      /\b(?:facilities|amenities|lounge|lounges|restaurant|restaurants|food|dining|eat|coffee|cafe|snack|shops?|retail|duty\s*free|restroom|restrooms|washroom|washrooms|toilets?|shower|prayer\s*room|charging\s*station|charger|chargers|power\s*hub)\b/i,
      /\b(?:where\s*can\s*i\s*(?:eat|rest|charge|pray|shop))\b/i,
    ],
  },

  // Priority 12: Help & Capabilities
  {
    name: 'help',
    priority: 12,
    description: 'Requests list of supported features, commands, or system overview.',
    patterns: [
      /\b(?:help|what\s*can\s*you\s*do|how\s*(?:can|do)\s*you\s*help|commands?|options?|menu|capabilities|features)\b/i,
    ],
  },

  // Priority 13: Greetings
  {
    name: 'greeting',
    priority: 13,
    description: 'Warm opening greetings.',
    patterns: [
      /^(?:hi|hello|hey|good\s*(?:morning|afternoon|evening)|howdy|greetings|namaste)[!.,\s]*$/i,
      /\b(?:hi|hello|hey)\b/i,
    ],
  },
];

/**
 * Matches user message text to a supported intent and extracts entities.
 * Returns { intent, confidence, entities }.
 */
export function matchIntent(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return {
      intent: 'fallback',
      confidence: 0,
      entities: extractEntities(''),
    };
  }

  const entities = extractEntities(text);

  // If input matches flight number and asks status or has no other verbs:
  // E.g. "AI-101" or "Status of AI-101" -> flight_status
  // E.g. "1000000001" -> baggage_status

  for (const intent of INTENTS_CONFIG) {
    for (const pattern of intent.patterns) {
      if (pattern.test(text)) {
        return {
          intent: intent.name,
          confidence: 1.0,
          entities,
        };
      }
    }
  }

  // Fallback if no pattern matched
  return {
    intent: 'fallback',
    confidence: 0.0,
    entities,
  };
}
