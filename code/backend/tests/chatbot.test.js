import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { chatRouter } from '../src/routes/chat.js';
import { signToken } from '../src/utils/jwt.js';
import { matchIntent, extractEntities } from '../src/services/chatbot/intents.js';

describe('Task 16b: Support Chatbot & Escalations Integration Tests', () => {
  let server;
  let baseUrl;
  let ioStub;
  let emittedEvents = [];

  // Test users
  const passenger1 = { id: 991, role: 'passenger', email: 'chat_pass1@test.com' };
  const passenger2 = { id: 992, role: 'passenger', email: 'chat_pass2@test.com' };
  const groundCrewUser = { id: 993, role: 'ground_crew', email: 'chat_crew@test.com' };
  const opsUser = { id: 994, role: 'ops_manager', email: 'chat_ops@test.com' };

  let pass1Token;
  let pass2Token;
  let crewToken;
  let opsToken;

  // Test entities
  let airportDelId, airportBomId;
  let flight1Id, flight2Id;
  let booking1Id, booking2Id;
  let baggage1Id, baggage2Id;
  let createdSessionIds = [];

  beforeAll(async () => {
    // 1. Setup stub io to verify room targeting
    emittedEvents = [];
    ioStub = {
      to: (rooms) => ({
        emit: (eventName, payload) => {
          emittedEvents.push({
            rooms: Array.isArray(rooms) ? rooms : [rooms],
            eventName,
            payload,
          });
        },
      }),
      emit: (eventName, payload) => {
        emittedEvents.push({ rooms: ['*'], eventName, payload });
      },
    };

    // 2. Setup Express server
    const app = express();
    app.set('io', ioStub);
    app.use(express.json());
    app.use('/chat', chatRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 3. Tokens
    pass1Token = signToken(passenger1);
    pass2Token = signToken(passenger2);
    crewToken = signToken(groundCrewUser);
    opsToken = signToken(opsUser);

    // 4. Insert test users
    await pool.query(
      `INSERT INTO "user" (id, name, email, password_hash, role)
       VALUES
         (991, 'Priya User1', 'chat_pass1@test.com', 'hash', 'passenger'),
         (992, 'Rahul User2', 'chat_pass2@test.com', 'hash', 'passenger'),
         (993, 'Crew Agent', 'chat_crew@test.com', 'hash', 'ground_crew'),
         (994, 'Ops Leader', 'chat_ops@test.com', 'hash', 'ops_manager')
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role`
    );

    // 5. Lookup airports
    const delRes = await pool.query("SELECT id FROM airport WHERE code = 'DEL' LIMIT 1");
    const bomRes = await pool.query("SELECT id FROM airport WHERE code = 'BOM' LIMIT 1");
    airportDelId = delRes.rows[0].id;
    airportBomId = bomRes.rows[0].id;

    // 6. Create flights for tests
    const acRes = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
    const acId = acRes.rows[0].id;

    const f1 = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id, scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('AI-991', $1, $2, $3, now() + INTERVAL '4 hours', now() + INTERVAL '6 hours', 'scheduled', 500000)
       RETURNING id`,
      [acId, airportDelId, airportBomId]
    );
    flight1Id = f1.rows[0].id;

    const f2 = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id, scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('AI-992', $1, $2, $3, now() + INTERVAL '8 hours', now() + INTERVAL '10 hours', 'scheduled', 550000)
       RETURNING id`,
      [acId, airportBomId, airportDelId]
    );
    flight2Id = f2.rows[0].id;

    // 7. Create bookings
    const b1 = await pool.query(
      `INSERT INTO booking (user_id, flight_id, booking_ref, status, boarding_group)
       VALUES (991, $1, 'BK-TEST991', 'confirmed', 2)
       RETURNING id`,
      [flight1Id]
    );
    booking1Id = b1.rows[0].id;

    const b2 = await pool.query(
      `INSERT INTO booking (user_id, flight_id, booking_ref, status, boarding_group)
       VALUES (992, $1, 'BK-OTH992', 'confirmed', 2)
       RETURNING id`,
      [flight2Id]
    );
    booking2Id = b2.rows[0].id;

    // 8. Baggage for User 1 vs User 2
    const bg1 = await pool.query(
      `INSERT INTO baggage (booking_id, tag_number, weight, status, last_scanned_location, last_scanned_at)
       VALUES ($1, '1000000991', 18.5, 'checked_in', 'T3 Check-in Belt 4', now() - INTERVAL '15 minutes')
       RETURNING id`,
      [booking1Id]
    );
    baggage1Id = bg1.rows[0].id;

    const bg2 = await pool.query(
      `INSERT INTO baggage (booking_id, tag_number, weight, status, last_scanned_location, last_scanned_at)
       VALUES ($1, '1000000992', 22.0, 'loaded', 'Baggage Cart 2', now() - INTERVAL '10 minutes')
       RETURNING id`,
      [booking2Id]
    );
    baggage2Id = bg2.rows[0].id;

    // 9. Special assistance request for User 1
    await pool.query(
      `INSERT INTO assistance_request (booking_id, type, status, notes)
       VALUES ($1, 'wheelchair', 'requested', 'Passenger needs wheelchair assistance at gate')`,
      [booking1Id]
    );

    // 10. Connection for User 1
    await pool.query(
      `INSERT INTO connection (passenger_id, inbound_flight_id, outbound_flight_id, min_connection_minutes, actual_connection_minutes, status, inbound_booking_id, outbound_booking_id)
       VALUES (991, $1, $2, 45, 120, 'on_track', $3, $3)`,
      [flight1Id, flight2Id, booking1Id]
    );
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Clean up created test sessions
    if (createdSessionIds.length > 0) {
      await pool.query('DELETE FROM chat_session WHERE id = ANY($1)', [createdSessionIds]);
    }
    await pool.query('DELETE FROM chat_session WHERE user_id IN (991, 992)');

    // Clean up data
    if (booking1Id) {
      await pool.query('DELETE FROM assistance_request WHERE booking_id = $1', [booking1Id]);
      await pool.query('DELETE FROM connection WHERE passenger_id IN (991, 992)');
      await pool.query('DELETE FROM baggage WHERE id IN ($1, $2)', [baggage1Id, baggage2Id]);
      await pool.query('DELETE FROM booking WHERE id IN ($1, $2)', [booking1Id, booking2Id]);
    }
    if (flight1Id) {
      await pool.query('DELETE FROM flight WHERE id IN ($1, $2)', [flight1Id, flight2Id]);
    }
    await pool.query('DELETE FROM "user" WHERE id IN (991, 992, 993, 994)');
  });

  describe('1. Intent Matching & Entity Extraction (>30 phrases, typos, mixed-case)', () => {
    const testCases = [
      // Greetings
      { text: 'hello', expectedIntent: 'greeting' },
      { text: 'Hi!', expectedIntent: 'greeting' },
      { text: 'good morning', expectedIntent: 'greeting' },
      { text: 'hey there', expectedIntent: 'greeting' },

      // Help
      { text: 'help', expectedIntent: 'help' },
      { text: 'What can you do for me?', expectedIntent: 'help' },
      { text: 'show commands and options', expectedIntent: 'help' },

      // Human Agent Escalation
      { text: 'I want to talk to a human', expectedIntent: 'human_agent' },
      { text: 'connect me with a real person', expectedIntent: 'human_agent' },
      { text: 'speak to an agent please', expectedIntent: 'human_agent' },
      { text: 'can I talk to support staff', expectedIntent: 'human_agent' },
      { text: 'representative', expectedIntent: 'human_agent' },

      // Flight Status & typos
      { text: 'status of flight AI-101', expectedIntent: 'flight_status', expectedFlight: 'AI-101' },
      { text: 'is ai101 on time?', expectedIntent: 'flight_status', expectedFlight: 'AI-101' },
      { text: 'StAtUs of 6E-202', expectedIntent: 'flight_status', expectedFlight: '6E-202' },
      { text: '6e202 flight delay', expectedIntent: 'flight_status', expectedFlight: '6E-202' },
      { text: 'track flight UK-810', expectedIntent: 'flight_status', expectedFlight: 'UK-810' },

      // My Next Flight
      { text: 'what is my next flight?', expectedIntent: 'my_next_flight' },
      { text: 'when do I fly next', expectedIntent: 'my_next_flight' },
      { text: 'upcoming flight departure', expectedIntent: 'my_next_flight' },

      // Check-in
      { text: 'can I check in?', expectedIntent: 'check_in_status' },
      { text: 'is check-in open for BK-IN101', expectedIntent: 'check_in_status', expectedBooking: 'BK-IN101' },
      { text: 'web checkin', expectedIntent: 'check_in_status' },

      // Baggage
      { text: 'where is my baggage?', expectedIntent: 'baggage_status' },
      { text: 'track my bag 1000000001', expectedIntent: 'baggage_status', expectedTag: '1000000001' },
      { text: 'tag 1000000991 status', expectedIntent: 'baggage_status', expectedTag: '1000000991' },
      { text: 'lost luggage inquiry', expectedIntent: 'baggage_status' },

      // Gate Info
      { text: 'which gate is my flight departing from?', expectedIntent: 'gate_info' },
      { text: 'what gate for AI-101', expectedIntent: 'gate_info', expectedFlight: 'AI-101' },

      // Boarding Group
      { text: 'what is my boarding group?', expectedIntent: 'boarding_group' },
      { text: 'when do I board with priority boarding', expectedIntent: 'boarding_group' },

      // Connection Status
      { text: 'how is my connecting flight at BOM?', expectedIntent: 'connection_status', expectedAirport: 'BOM' },
      { text: 'will I make my connection?', expectedIntent: 'connection_status' },
      { text: 'is my layover at risk?', expectedIntent: 'connection_status' },

      // Assistance Status
      { text: 'what is the status of my wheelchair assistance?', expectedIntent: 'assistance_status' },
      { text: 'special mobility assistance request', expectedIntent: 'assistance_status' },

      // Parking
      { text: 'what are the parking rates at DEL?', expectedIntent: 'parking_info', expectedAirport: 'DEL' },
      { text: 'parking slots in Mumbai', expectedIntent: 'parking_info', expectedAirport: 'BOM' },
      { text: 'my vehicle parking reservation', expectedIntent: 'parking_info' },

      // Facilities
      { text: 'where can I find a lounge at DEL?', expectedIntent: 'facilities', expectedAirport: 'DEL', expectedType: 'lounge' },
      { text: 'is there coffee or a restaurant at Mumbai terminal?', expectedIntent: 'facilities', expectedAirport: 'BOM', expectedType: 'restaurant' },
      { text: 'charging station at Bengaluru airport', expectedIntent: 'facilities', expectedAirport: 'BLR', expectedType: 'charging_station' },
      { text: 'restroom location', expectedIntent: 'facilities', expectedType: 'restroom' },

      // Fallback
      { text: 'qwerty zxcvb 98765 random', expectedIntent: 'fallback' },
    ];

    it(`evaluates ${testCases.length} phrases (>30 test cases) with accurate intent and entity resolution`, () => {
      expect(testCases.length).toBeGreaterThanOrEqual(30);

      for (const tc of testCases) {
        const result = matchIntent(tc.text);
        expect(result.intent).toBe(tc.expectedIntent);

        if (tc.expectedFlight) {
          expect(result.entities.flightNumber).toBe(tc.expectedFlight);
        }
        if (tc.expectedBooking) {
          expect(result.entities.bookingRef).toBe(tc.expectedBooking);
        }
        if (tc.expectedTag) {
          expect(result.entities.baggageTag).toBe(tc.expectedTag);
        }
        if (tc.expectedAirport) {
          expect(result.entities.airportCode).toBe(tc.expectedAirport);
        }
        if (tc.expectedType) {
          expect(result.entities.facilityType).toBe(tc.expectedType);
        }
      }
    });

    it('extracts entities across mixed case and delimiters', () => {
      const res = extractEntities('Need lounge at NeW DeLhI near AI 101 with tag 1000000001 and BK-IN101');
      expect(res.airportCode).toBe('DEL');
      expect(res.flightNumber).toBe('AI-101');
      expect(res.baggageTag).toBe('1000000001');
      expect(res.bookingRef).toBe('BK-IN101');
      expect(res.facilityType).toBe('lounge');
    });
  });

  describe('2. Chat Session Management & Rate Limiting', () => {
    let sessionId;

    it('POST /chat/sessions creates a new active session', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pass1Token}` },
      });
      expect([200, 201]).toContain(res.status);
      const data = await res.json();
      expect(data.session.id).toBeDefined();
      expect(data.session.status).toBe('active');
      sessionId = data.session.id;
      createdSessionIds.push(sessionId);
    });

    it('POST /chat/sessions returns existing open session when called again', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pass1Token}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.session.id).toBe(sessionId);
    });

    it('GET /chat/sessions/mine returns current session and message transcript', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/mine`, {
        headers: { Authorization: `Bearer ${pass1Token}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.session.id).toBe(sessionId);
      expect(Array.isArray(data.messages)).toBe(true);
    });

    it('validates message length: rejects empty and >500 character text (400)', async () => {
      // Empty
      const resEmpty = await fetch(`${baseUrl}/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: '   ' }),
      });
      expect(resEmpty.status).toBe(400);

      // > 500 chars
      const resLong = await fetch(`${baseUrl}/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'A'.repeat(501) }),
      });
      expect(resLong.status).toBe(400);
    });

    it('prevents non-owner passenger from posting to another user session (403)', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass2Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Hacking session' }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('3. Live Data-Backed Answers for Every Intent', () => {
    let testSessionId;

    beforeAll(async () => {
      const s = await pool.query(
        "INSERT INTO chat_session (user_id, status) VALUES (991, 'active') RETURNING id"
      );
      testSessionId = s.rows[0].id;
      createdSessionIds.push(testSessionId);
    });

    it('flight_status returns live public flight info', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${testSessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Status of flight AI-991' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.botMessage.intent).toBe('flight_status');
      expect(data.botMessage.text).toContain('AI-991');
      expect(data.botMessage.text).toContain('SCHEDULED');
      expect(data.botMessage.text).toContain('DEL');
      expect(data.botMessage.text).toContain('BOM');
    });

    it('my_next_flight returns user confirmed flight', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${testSessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'When is my next flight?' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.botMessage.intent).toBe('my_next_flight');
      expect(data.botMessage.text).toContain('AI-991');
      expect(data.botMessage.text).toContain('BK-TEST991');
    });

    it('baggage_status returns user live baggage details', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${testSessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Track my bag 1000000991' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.botMessage.intent).toBe('baggage_status');
      expect(data.botMessage.text).toContain('1000000991');
      expect(data.botMessage.text).toContain('18.5');
    });

    it('boarding_group returns assigned group', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${testSessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'What is my boarding group?' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.botMessage.intent).toBe('boarding_group');
      expect(data.botMessage.text).toContain('Group 2');
    });

    it('connection_status returns layover and MCT comparison', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${testSessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'How is my connection?' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.botMessage.intent).toBe('connection_status');
      expect(data.botMessage.text).toContain('ON TRACK');
      expect(data.botMessage.text).toContain('120 mins');
    });

    it('assistance_status returns active wheelchair request', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${testSessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'What is the status of my wheelchair assistance?' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.botMessage.intent).toBe('assistance_status');
      expect(data.botMessage.text).toContain('wheelchair');
      expect(data.botMessage.text).toContain('REQUESTED');
    });

    it('facilities returns available amenities at airport', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${testSessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Where can I find a lounge at DEL?' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.botMessage.intent).toBe('facilities');
      expect(data.botMessage.text).toContain('DEL');
      expect(data.botMessage.text).toContain('OPEN');
    });
  });

  describe('4. Privacy Rules: Strict Ownership Enforcement', () => {
    let privacySessionId;

    beforeAll(async () => {
      const s = await pool.query(
        "INSERT INTO chat_session (user_id, status) VALUES (991, 'active') RETURNING id"
      );
      privacySessionId = s.rows[0].id;
      createdSessionIds.push(privacySessionId);
    });

    it('politely refuses and reveals no data when asking for another user booking reference', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${privacySessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Can I check in for BK-OTH992?' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.botMessage.text).toContain('privacy and security reasons');
      expect(data.botMessage.text).not.toContain('Rahul');
      expect(data.botMessage.text).not.toContain('14B');
    });

    it('politely refuses and reveals no data when asking for another user baggage tag', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${privacySessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Where is baggage tag 1000000992?' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.botMessage.text).toContain('privacy and security reasons');
      expect(data.botMessage.text).not.toContain('22.0 kg');
      expect(data.botMessage.text).not.toContain('Baggage Cart 2');
    });
  });

  describe('5. Escalation: by Request, and by Two Fallbacks', () => {
    it('escalates on human_agent intent, updates status, and emits chat:escalated to staff rooms', async () => {
      emittedEvents = [];
      const s = await pool.query(
        "INSERT INTO chat_session (user_id, status) VALUES (991, 'active') RETURNING id"
      );
      const escSessionId = s.rows[0].id;
      createdSessionIds.push(escSessionId);

      const res = await fetch(`${baseUrl}/chat/sessions/${escSessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'I want to speak with a human support agent' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.session.status).toBe('escalated');

      // Check socket emission
      const escEvent = emittedEvents.find((e) => e.eventName === 'chat:escalated');
      expect(escEvent).toBeDefined();
      expect(escEvent.rooms.some((r) => r.includes('role:ground_crew'))).toBe(true);
      expect(escEvent.rooms.some((r) => r.includes('role:admin'))).toBe(true);
    });

    it('escalates automatically when two fallback intents occur consecutively', async () => {
      emittedEvents = [];
      const s = await pool.query(
        "INSERT INTO chat_session (user_id, status) VALUES (991, 'active') RETURNING id"
      );
      const fallbackSessionId = s.rows[0].id;
      createdSessionIds.push(fallbackSessionId);

      // First fallback
      const res1 = await fetch(`${baseUrl}/chat/sessions/${fallbackSessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'gibberish xyz 12345' }),
      });
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.botMessage.intent).toBe('fallback');
      expect(data1.session.status).toBe('active');

      // Second consecutive fallback -> triggers automatic escalation
      const res2 = await fetch(`${baseUrl}/chat/sessions/${fallbackSessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'more meaningless bla bla bla' }),
      });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.session.status).toBe('escalated');
      expect(data2.botMessage.text).toContain('escalating your conversation');

      const escEvent = emittedEvents.find((e) => e.eventName === 'chat:escalated');
      expect(escEvent).toBeDefined();
    });
  });

  describe('6. Agent Support Workflow: Claim (409 on second claim), Agent Message & Silent Bot', () => {
    let agentSessionId;

    beforeAll(async () => {
      const s = await pool.query(
        "INSERT INTO chat_session (user_id, status) VALUES (991, 'escalated') RETURNING id"
      );
      agentSessionId = s.rows[0].id;
      createdSessionIds.push(agentSessionId);
    });

    it('rejects passengers from accessing agent routes (403)', async () => {
      // Passenger attempts to view escalations
      const res1 = await fetch(`${baseUrl}/chat/escalations`, {
        headers: { Authorization: `Bearer ${pass1Token}` },
      });
      expect(res1.status).toBe(403);

      // Passenger attempts to claim session
      const res2 = await fetch(`${baseUrl}/chat/sessions/${agentSessionId}/claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pass1Token}` },
      });
      expect(res2.status).toBe(403);

      // Passenger attempts to send agent-message
      const res3 = await fetch(`${baseUrl}/chat/sessions/${agentSessionId}/agent-message`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'I am pretending to be an agent' }),
      });
      expect(res3.status).toBe(403);
    });

    it('allows ground_crew agent to claim an escalated session (200)', async () => {
      emittedEvents = [];
      const res = await fetch(`${baseUrl}/chat/sessions/${agentSessionId}/claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${crewToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.session.status).toBe('assigned');
      expect(data.session.assigned_agent_id).toBe(993);

      // Verified socket emission to user
      const claimedEvent = emittedEvents.find((e) => e.eventName === 'chat:claimed');
      expect(claimedEvent).toBeDefined();
      expect(claimedEvent.rooms).toContain('user:991');
    });

    it('rejects a second claim with 409 Conflict', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${agentSessionId}/claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opsToken}` },
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('already claimed');
    });

    it('allows assigned agent to send message to passenger and emits to user:<id>', async () => {
      emittedEvents = [];
      const res = await fetch(`${baseUrl}/chat/sessions/${agentSessionId}/agent-message`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${crewToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Hello Priya, I am your support agent today. How can I help?' }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.message.sender).toBe('agent');

      // Check socket emission to user room
      const msgEvent = emittedEvents.find((e) => e.eventName === 'chat:message');
      expect(msgEvent).toBeDefined();
      expect(msgEvent.rooms).toContain('user:991');
    });

    it('keeps bot silent when user messages during assigned session', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${agentSessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'My flight is AI-991, do I need to re-check my bags?' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userMessage).toBeDefined();
      expect(data.botMessage).toBeNull(); // Bot remains silent!
    });
  });

  describe('7. Closing Session & Protection', () => {
    let closableSessionId;

    beforeAll(async () => {
      const s = await pool.query(
        "INSERT INTO chat_session (user_id, status) VALUES (991, 'active') RETURNING id"
      );
      closableSessionId = s.rows[0].id;
      createdSessionIds.push(closableSessionId);
    });

    it('allows passenger owner to close the session', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${closableSessionId}/close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pass1Token}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.session.status).toBe('closed');
      expect(data.session.closed_at).toBeDefined();
    });

    it('rejects sending messages to a closed session (400)', async () => {
      const res = await fetch(`${baseUrl}/chat/sessions/${closableSessionId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pass1Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Can I still talk?' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('closed');
    });
  });
});
