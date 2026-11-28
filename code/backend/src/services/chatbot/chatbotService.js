import { pool } from '../../db/pool.js';
import { matchIntent, extractEntities } from './intents.js';

/**
 * Format INR currency in rupees with Indian grouping.
 * Consistent with project standard.
 */
function formatINR(rupees) {
  if (rupees === null || rupees === undefined || isNaN(rupees)) return '₹0';
  const num = Math.round(Number(rupees));
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(num);
}

function formatDate(iso) {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'TBD';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(iso) {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'TBD';
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Process a passenger message against live data and generate a structured reply.
 *
 * @param {Object} options
 * @param {string} options.text - Raw text sent by the user
 * @param {Object} options.user - Logged-in user { id, email, role, name }
 * @param {number} options.sessionId - ID of the active chat_session
 * @returns {Promise<{ intent: string, replyText: string, shouldEscalate: boolean }>}
 */
export async function processChatbotMessage({ text, user, sessionId }) {
  const { intent, entities } = matchIntent(text);

  let replyText = '';
  let shouldEscalate = false;

  switch (intent) {
    case 'human_agent': {
      shouldEscalate = true;
      replyText =
        'I am connecting you with a member of our airport operations and support team. Please hold on while an agent joins the conversation.';
      break;
    }

    case 'greeting': {
      replyText =
        'Hello! I am the Meridian Airport Virtual Assistant. How can I assist you with your airport journey today? You can ask me about flight status, check-in, baggage, boarding groups, parking, or airport facilities.';
      break;
    }

    case 'help': {
      replyText =
        'Here is what I can help you with:\n' +
        '• Flight Status: Ask "Status of AI-101" or "Is flight 6E-202 on time?"\n' +
        '• My Next Flight: Ask "When is my next flight?" or "My departure"\n' +
        '• Web Check-in: Ask "Can I check in?" or "Is check-in open for BK-IN101?"\n' +
        '• Baggage: Ask "Where is my luggage?" or track with your 10-digit tag\n' +
        '• Gate & Boarding: Ask "Which gate is my flight?" or "What is my boarding group?"\n' +
        '• Connections: Ask "How is my connection at BOM?"\n' +
        '• Airport Facilities: Ask "Where can I find a lounge or coffee at DEL?"\n' +
        '• Parking: Ask "What are the parking rates at BLR?" or check your parking reservations\n' +
        '• Special Assistance: Ask about your wheelchair or assistance requests\n' +
        '• Talk to a Person: Ask "Talk to an agent" to connect directly with support staff.';
      break;
    }

    case 'flight_status': {
      replyText = await handleFlightStatus({ entities, user });
      break;
    }

    case 'my_next_flight': {
      replyText = await handleMyNextFlight({ user });
      break;
    }

    case 'check_in_status': {
      replyText = await handleCheckInStatus({ entities, user });
      break;
    }

    case 'baggage_status': {
      replyText = await handleBaggageStatus({ entities, user });
      break;
    }

    case 'gate_info': {
      replyText = await handleGateInfo({ entities, user });
      break;
    }

    case 'boarding_group': {
      replyText = await handleBoardingGroup({ entities, user });
      break;
    }

    case 'connection_status': {
      replyText = await handleConnectionStatus({ user });
      break;
    }

    case 'assistance_status': {
      replyText = await handleAssistanceStatus({ user });
      break;
    }

    case 'parking_info': {
      replyText = await handleParkingInfo({ entities, user });
      break;
    }

    case 'facilities': {
      replyText = await handleFacilities({ entities, user });
      break;
    }

    case 'fallback':
    default: {
      // Check if previous bot message in this session was also a fallback
      // Two fallbacks in a row triggers automatic escalation
      const lastMessages = await pool.query(
        `SELECT id, sender, intent
           FROM chat_message
          WHERE session_id = $1
          ORDER BY "timestamp" DESC
          LIMIT 2`,
        [sessionId]
      );

      // If the last bot reply in this session was a fallback, escalate
      const lastBotMsg = lastMessages.rows.find((m) => m.sender === 'bot');
      if (lastBotMsg && lastBotMsg.intent === 'fallback') {
        shouldEscalate = true;
        replyText =
          'I apologize for the confusion. I am escalating your conversation to our airport operations support team so an agent can assist you directly.';
      } else {
        replyText =
          "I'm sorry, I didn't quite catch that. You can ask me about flight status (e.g. 'Status of AI-101'), check-in, baggage tracking, boarding groups, airport facilities, or say 'Talk to an agent' to speak with support staff.";
      }
      break;
    }
  }

  return {
    intent,
    replyText,
    shouldEscalate,
  };
}

/**
 * Public flight status inquiry.
 */
async function handleFlightStatus({ entities, user }) {
  let targetFlightNum = entities.flightNumber;

  // If no flight number in message, check if user has an upcoming booking
  if (!targetFlightNum && user?.id) {
    const userFlightRes = await pool.query(
      `SELECT f.flight_number
         FROM booking b
         JOIN flight f ON f.id = b.flight_id
        WHERE b.user_id = $1
          AND b.status IN ('confirmed', 'checked_in')
          AND f.status NOT IN ('cancelled', 'landed')
        ORDER BY f.scheduled_departure ASC
        LIMIT 1`,
      [user.id]
    );
    if (userFlightRes.rows.length > 0) {
      targetFlightNum = userFlightRes.rows[0].flight_number;
    }
  }

  if (!targetFlightNum) {
    return 'Please provide a flight number (e.g. AI-101 or 6E-202) to check its live status.';
  }

  // Lookup flight
  const flightRes = await pool.query(
    `SELECT f.id, f.flight_number, f.status, f.scheduled_departure, f.scheduled_arrival,
            f.actual_departure, f.actual_arrival,
            o.code AS origin_code, o.city AS origin_city,
            d.code AS dest_code, d.city AS dest_city,
            g.code AS gate_code,
            (SELECT minutes FROM delay_log WHERE flight_id = f.id ORDER BY "timestamp" DESC LIMIT 1) AS delay_minutes
       FROM flight f
       JOIN airport o ON o.id = f.origin_id
       JOIN airport d ON d.id = f.dest_id
  LEFT JOIN gate g ON g.id = f.gate_id
      WHERE f.flight_number ILIKE $1
         OR REPLACE(f.flight_number, '-', '') ILIKE REPLACE($1, '-', '')
      LIMIT 1`,
    [targetFlightNum]
  );

  if (flightRes.rows.length === 0) {
    return `Flight ${targetFlightNum} was not found. Please double-check the airline code and flight number.`;
  }

  const f = flightRes.rows[0];
  const depTime = `${formatDate(f.scheduled_departure)} at ${formatTime(f.scheduled_departure)}`;
  const gateStr = f.gate_code ? `Gate ${f.gate_code}` : 'Gate TBD';
  const delayStr = f.delay_minutes ? ` (Delayed by ${f.delay_minutes} minutes)` : '';

  return (
    `Flight ${f.flight_number} from ${f.origin_code} (${f.origin_city}) to ${f.dest_code} (${f.dest_city}) is currently ` +
    `${f.status.toUpperCase()}${delayStr}. Scheduled departure: ${depTime}. Departure ${gateStr}.`
  );
}

/**
 * Passenger next upcoming flight inquiry.
 */
async function handleMyNextFlight({ user }) {
  if (!user?.id) {
    return 'Please log in to view your upcoming flight schedule.';
  }

  const res = await pool.query(
    `SELECT b.booking_ref, b.status AS booking_status,
            f.flight_number, f.status AS flight_status,
            f.scheduled_departure, f.scheduled_arrival,
            o.code AS origin_code, o.city AS origin_city,
            d.code AS dest_code, d.city AS dest_city,
            g.code AS gate_code
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
       JOIN airport o ON o.id = f.origin_id
       JOIN airport d ON d.id = f.dest_id
  LEFT JOIN gate g ON g.id = f.gate_id
      WHERE b.user_id = $1
        AND b.status IN ('confirmed', 'checked_in')
        AND f.status NOT IN ('cancelled', 'landed')
      ORDER BY f.scheduled_departure ASC
      LIMIT 1`,
    [user.id]
  );

  if (res.rows.length === 0) {
    return 'You do not have any upcoming confirmed flights scheduled under your account.';
  }

  const b = res.rows[0];
  const depStr = `${formatDate(b.scheduled_departure)} at ${formatTime(b.scheduled_departure)}`;
  const gateStr = b.gate_code ? `Gate ${b.gate_code}` : 'Gate TBD';

  return (
    `Your next flight is ${b.flight_number} from ${b.origin_code} (${b.origin_city}) to ${b.dest_code} (${b.dest_city}), ` +
    `scheduled to depart on ${depStr}. Booking reference: ${b.booking_ref}. Status: ${b.flight_status.toUpperCase()} (${gateStr}).`
  );
}

/**
 * Check-in status with strict privacy check.
 */
async function handleCheckInStatus({ entities, user }) {
  if (!user?.id) {
    return 'Please log in to view check-in information.';
  }

  if (entities.bookingRef) {
    // Check if booking exists and check user ownership
    const bookingRes = await pool.query(
      `SELECT b.id, b.user_id, b.booking_ref, b.status AS booking_status,
              f.flight_number, f.status AS flight_status, f.scheduled_departure
         FROM booking b
         JOIN flight f ON f.id = b.flight_id
        WHERE b.booking_ref ILIKE $1`,
      [entities.bookingRef]
    );

    if (bookingRes.rows.length === 0) {
      return `Booking reference ${entities.bookingRef} was not found. Please verify your reference number.`;
    }

    const b = bookingRes.rows[0];

    // PRIVACY ENFORCEMENT: Only owner can view
    if (b.user_id !== user.id) {
      return 'For privacy and security reasons, I can only provide check-in information for bookings linked directly to your account.';
    }

    if (b.booking_status === 'checked_in') {
      return `You are already checked in for booking ${b.booking_ref} (Flight ${b.flight_number}). Your digital boarding pass is available in My Flights.`;
    }

    const depDate = new Date(b.scheduled_departure);
    const now = new Date();
    const hoursToDep = (depDate.getTime() - now.getTime()) / 3600_000;

    if (hoursToDep <= 48 && hoursToDep > 0) {
      return `Web check-in is currently OPEN for booking ${b.booking_ref} (Flight ${b.flight_number}). You can complete your check-in right now in the My Flights section.`;
    }

    return `Web check-in for booking ${b.booking_ref} (Flight ${b.flight_number}) opens 48 hours before scheduled departure (${formatDate(b.scheduled_departure)} at ${formatTime(b.scheduled_departure)}).`;
  }

  // No booking reference provided: query user's earliest pending booking
  const nextRes = await pool.query(
    `SELECT b.booking_ref, b.status AS booking_status,
            f.flight_number, f.scheduled_departure
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
      WHERE b.user_id = $1
        AND b.status IN ('confirmed', 'checked_in')
        AND f.status NOT IN ('cancelled', 'landed')
      ORDER BY f.scheduled_departure ASC
      LIMIT 1`,
    [user.id]
  );

  if (nextRes.rows.length === 0) {
    return 'You do not have any pending flight bookings requiring check-in at this time.';
  }

  const nextB = nextRes.rows[0];
  if (nextB.booking_status === 'checked_in') {
    return `You are already checked in for your next flight ${nextB.flight_number} (Booking ${nextB.booking_ref}).`;
  }

  return `Web check-in is available for your upcoming flight ${nextB.flight_number} (Booking ${nextB.booking_ref}) starting 48 hours before departure.`;
}

/**
 * Baggage tracking with strict privacy check.
 */
async function handleBaggageStatus({ entities, user }) {
  if (!user?.id) {
    return 'Please log in to track your checked baggage.';
  }

  // 1. Specific tag provided
  if (entities.baggageTag) {
    const bagRes = await pool.query(
      `SELECT bg.tag_number, bg.weight, bg.status, bg.last_scanned_location, bg.last_scanned_at,
              b.user_id, b.booking_ref, f.flight_number
         FROM baggage bg
         JOIN booking b ON b.id = bg.booking_id
         JOIN flight f ON f.id = b.flight_id
        WHERE bg.tag_number = $1`,
      [entities.baggageTag]
    );

    if (bagRes.rows.length === 0) {
      return `Baggage tag ${entities.baggageTag} was not found. Please double-check the 10-digit tag number on your baggage claim tag.`;
    }

    const bag = bagRes.rows[0];

    // PRIVACY ENFORCEMENT: Never reveal other passengers' baggage
    if (bag.user_id !== user.id) {
      return 'For privacy and security reasons, baggage tracking is only available for bags checked under your own account.';
    }

    const scanLoc = bag.last_scanned_location || 'Airport Check-in Desk';
    const scanTime = bag.last_scanned_at ? ` at ${formatTime(bag.last_scanned_at)}` : '';

    return (
      `Baggage Tag ${bag.tag_number} (Flight ${bag.flight_number}, ${bag.weight} kg) is currently ` +
      `${bag.status.toUpperCase()}. Last scanned at ${scanLoc}${scanTime}.`
    );
  }

  // 2. Query all baggage for current user
  const userBags = await pool.query(
    `SELECT bg.tag_number, bg.weight, bg.status, bg.last_scanned_location, bg.last_scanned_at,
            f.flight_number
       FROM baggage bg
       JOIN booking b ON b.id = bg.booking_id
       JOIN flight f ON f.id = b.flight_id
      WHERE b.user_id = $1
      ORDER BY bg.id DESC
      LIMIT 4`,
    [user.id]
  );

  if (userBags.rows.length === 0) {
    return 'No checked baggage records were found for your current flights.';
  }

  const bagItems = userBags.rows.map((b) => {
    const loc = b.last_scanned_location || 'Check-in Desk';
    return `• Tag ${b.tag_number} (${b.flight_number}, ${b.weight} kg): ${b.status.toUpperCase()} at ${loc}`;
  });

  return `Here is the status of your checked baggage:\n${bagItems.join('\n')}`;
}

/**
 * Gate information inquiry.
 */
async function handleGateInfo({ entities, user }) {
  let targetFlightNum = entities.flightNumber;

  if (!targetFlightNum && user?.id) {
    const nextRes = await pool.query(
      `SELECT f.flight_number
         FROM booking b
         JOIN flight f ON f.id = b.flight_id
        WHERE b.user_id = $1
          AND b.status IN ('confirmed', 'checked_in')
          AND f.status NOT IN ('cancelled', 'landed')
        ORDER BY f.scheduled_departure ASC
        LIMIT 1`,
      [user.id]
    );
    if (nextRes.rows.length > 0) {
      targetFlightNum = nextRes.rows[0].flight_number;
    }
  }

  if (!targetFlightNum) {
    return 'Please provide a flight number (e.g. AI-101) to find its departure gate.';
  }

  const res = await pool.query(
    `SELECT f.flight_number, f.status, g.code AS gate_code, o.code AS origin_code
       FROM flight f
       JOIN airport o ON o.id = f.origin_id
  LEFT JOIN gate g ON g.id = f.gate_id
      WHERE f.flight_number ILIKE $1
         OR REPLACE(f.flight_number, '-', '') ILIKE REPLACE($1, '-', '')
      LIMIT 1`,
    [targetFlightNum]
  );

  if (res.rows.length === 0) {
    return `Flight ${targetFlightNum} was not found. Please verify the flight number.`;
  }

  const f = res.rows[0];
  if (!f.gate_code) {
    return `Flight ${f.flight_number} (${f.origin_code}) departure gate has not been assigned yet. Please monitor the airport departure screens.`;
  }

  return `Flight ${f.flight_number} is scheduled to depart from Gate ${f.gate_code} at ${f.origin_code}. Status: ${f.status.toUpperCase()}.`;
}

/**
 * Boarding group inquiry.
 */
async function handleBoardingGroup({ user }) {
  if (!user?.id) {
    return 'Please log in to view your assigned boarding group.';
  }

  const res = await pool.query(
    `SELECT b.booking_ref, b.boarding_group, f.flight_number, g.code AS gate_code
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
  LEFT JOIN gate g ON g.id = f.gate_id
      WHERE b.user_id = $1
        AND b.status IN ('confirmed', 'checked_in')
        AND f.status NOT IN ('cancelled', 'landed')
      ORDER BY f.scheduled_departure ASC
      LIMIT 1`,
    [user.id]
  );

  if (res.rows.length === 0) {
    return 'You do not have any active flight bookings with an assigned boarding group right now.';
  }

  const b = res.rows[0];
  const groupNum = b.boarding_group || 2;
  const groupLabel = groupNum === 1 ? 'Priority Boarding (Group 1)' : 'General Boarding (Group 2)';
  const gateStr = b.gate_code ? `at Gate ${b.gate_code}` : '';

  return (
    `For Flight ${b.flight_number} (Booking ${b.booking_ref}), your assigned boarding group is ${groupLabel}. ` +
    `Please listen for boarding announcements ${gateStr} when your group is called.`
  );
}

/**
 * Connection status inquiry.
 */
async function handleConnectionStatus({ user }) {
  if (!user?.id) {
    return 'Please log in to check your connection status.';
  }

  const res = await pool.query(
    `SELECT c.id, c.status, c.actual_connection_minutes AS layover_minutes,
            af.flight_number AS arr_flight,
            df.flight_number AS dep_flight,
            ap.code AS hub_code, ap.city AS hub_city,
            ap.min_connection_minutes AS mct
       FROM connection c
       JOIN flight af ON af.id = c.inbound_flight_id
       JOIN flight df ON df.id = c.outbound_flight_id
       JOIN airport ap ON ap.id = af.dest_id
      WHERE c.passenger_id = $1
        AND c.status != 'cancelled'
      ORDER BY c.created_at DESC
      LIMIT 1`,
    [user.id]
  );

  if (res.rows.length === 0) {
    return 'You do not have any active connecting flight itineraries registered under your account.';
  }

  const c = res.rows[0];
  const statusLabel =
    c.status === 'on_track'
      ? 'ON TRACK'
      : c.status === 'at_risk'
      ? 'AT RISK (Tight Layover)'
      : 'MISSED (Action Required)';

  return (
    `Your flight connection at ${c.hub_code} (${c.hub_city}) between Flight ${c.arr_flight} and Flight ${c.dep_flight} ` +
    `is currently ${statusLabel}. Your scheduled layover is ${c.layover_minutes} mins (Airport Minimum Connection Time: ${c.mct} mins).`
  );
}

/**
 * Assistance requests status inquiry.
 */
async function handleAssistanceStatus({ user }) {
  if (!user?.id) {
    return 'Please log in to view special assistance requests.';
  }

  const res = await pool.query(
    `SELECT a.type, a.status, a.notes, b.booking_ref, f.flight_number
       FROM assistance_request a
       JOIN booking b ON b.id = a.booking_id
       JOIN flight f ON f.id = b.flight_id
      WHERE b.user_id = $1
        AND a.status != 'cancelled'
      ORDER BY a.created_at DESC
      LIMIT 1`,
    [user.id]
  );

  if (res.rows.length === 0) {
    return 'You do not have any active special assistance requests. You can request wheelchair or medical support in My Flights.';
  }

  const a = res.rows[0];
  const typeLabel = a.type.replace('_', ' ');
  return (
    `You have an active ${typeLabel} assistance request for Flight ${a.flight_number} (Booking ${a.booking_ref}). ` +
    `Status: ${a.status.toUpperCase()}. Airport staff will be prepared to assist you upon arrival at the gate.`
  );
}

/**
 * Parking bookings and hourly rates inquiry.
 */
async function handleParkingInfo({ entities, user }) {
  // 1. If user has active parking booking
  if (user?.id) {
    const userParkRes = await pool.query(
      `SELECT pb.booking_ref, pb.status, pb.reserved_from, pb.reserved_until, pb.vehicle_number,
              pl.name AS lot_name, ps.slot_number, ap.code AS airport_code
         FROM parking_booking pb
         JOIN parking_slot ps ON ps.id = pb.slot_id
         JOIN parking_lot pl ON pl.id = ps.lot_id
         JOIN airport ap ON ap.id = pl.airport_id
        WHERE pb.user_id = $1
          AND pb.status IN ('reserved', 'active')
        ORDER BY pb.created_at DESC
        LIMIT 1`,
      [user.id]
    );

    if (userParkRes.rows.length > 0) {
      const p = userParkRes.rows[0];
      const fromStr = `${formatDate(p.reserved_from)} ${formatTime(p.reserved_from)}`;
      const untilStr = `${formatDate(p.reserved_until)} ${formatTime(p.reserved_until)}`;
      return (
        `You have an active parking reservation (${p.booking_ref}) at ${p.lot_name} (Slot ${p.slot_number}, ${p.airport_code}) ` +
        `for vehicle ${p.vehicle_number} from ${fromStr} to ${untilStr}. Status: ${p.status.toUpperCase()}.`
      );
    }
  }

  // 2. Query parking lot rates at requested airport (or DEL default)
  const targetAirport = entities.airportCode || 'DEL';
  const lotsRes = await pool.query(
    `SELECT pl.name, pl.hourly_rate, pl.total_slots, ap.code, ap.name AS airport_name
       FROM parking_lot pl
       JOIN airport ap ON ap.id = pl.airport_id
      WHERE ap.code = $1
      ORDER BY pl.hourly_rate ASC
      LIMIT 3`,
    [targetAirport]
  );

  if (lotsRes.rows.length === 0) {
    return `Parking lots for airport ${targetAirport} are currently not listed. You can book airport parking on the Parking page.`;
  }

  const lotItems = lotsRes.rows.map((l) => `• ${l.name}: ${formatINR(l.hourly_rate)}/hr (${l.total_slots} slots)`);
  return `Parking rates at ${lotsRes.rows[0].airport_name} (${targetAirport}):\n${lotItems.join('\n')}\nYou can book a slot in advance on our Parking page.`;
}

/**
 * Airport facilities inquiry (lounges, restaurants, shops, restrooms, prayer rooms, charging stations).
 */
async function handleFacilities({ entities, user }) {
  // Determine airport: either from extracted entities or user's next flight or default 'DEL'
  let targetAirport = entities.airportCode;

  if (!targetAirport && user?.id) {
    const flightAirportRes = await pool.query(
      `SELECT o.code AS origin_code
         FROM booking b
         JOIN flight f ON f.id = b.flight_id
         JOIN airport o ON o.id = f.origin_id
        WHERE b.user_id = $1
          AND b.status IN ('confirmed', 'checked_in')
          AND f.status NOT IN ('cancelled', 'landed')
        ORDER BY f.scheduled_departure ASC
        LIMIT 1`,
      [user.id]
    );
    if (flightAirportRes.rows.length > 0) {
      targetAirport = flightAirportRes.rows[0].origin_code;
    }
  }

  if (!targetAirport) {
    targetAirport = 'DEL';
  }

  const facilityType = entities.facilityType || null;

  let query = `
    SELECT f.name, f.type, f.location_terminal, f.location_gate_proximity, f.status, a.code AS airport_code
      FROM facility f
      JOIN airport a ON a.id = f.airport_id
     WHERE a.code = $1
  `;
  const params = [targetAirport];

  if (facilityType) {
    params.push(facilityType);
    query += ` AND f.type = $${params.length}`;
  }

  // Open facilities first, then by terminal
  query += ` ORDER BY (CASE WHEN f.status = 'open' THEN 0 ELSE 1 END), f.location_terminal ASC, f.name ASC LIMIT 5`;

  const res = await pool.query(query, params);

  if (res.rows.length === 0) {
    const typeLabel = facilityType ? ` ${facilityType}` : '';
    return `No${typeLabel} facilities were found at ${targetAirport}. Please check the Facilities page for a complete directory.`;
  }

  const items = res.rows.map((f) => {
    const loc = f.location_terminal || 'Main Terminal';
    const gate = f.location_gate_proximity ? ` (${f.location_gate_proximity})` : '';
    return `• ${f.name} — ${loc}${gate} [${f.status.toUpperCase()}]`;
  });

  const header = facilityType
    ? `Here are the ${facilityType.replace('_', ' ')} facilities at ${targetAirport}:`
    : `Here are available amenities and facilities at ${targetAirport}:`;

  return `${header}\n${items.join('\n')}`;
}
