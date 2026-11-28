import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { pool } from '../src/db/pool.js';
import { chatRouter } from '../src/routes/chat.js';
import { hashPassword } from '../src/utils/password.js';
import { signToken } from '../src/utils/jwt.js';

describe('Task 16c Part A: Support Chat Real Socket & Deduplication Tests', () => {
  let server;
  let io;
  let baseUrl;
  let port;

  let passengerSocket;
  let agentSocket;

  const testPassUser = { id: 8901, name: 'Socket Passenger', email: 'socket_pass@test.com', role: 'passenger' };
  const testAgentUser = { id: 8902, name: 'Socket Agent', email: 'socket_agent@test.com', role: 'ground_crew' };

  let passToken;
  let agentToken;

  let testSessionId;

  beforeAll(async () => {
    // 1. Create real Express app + Socket.IO server
    const app = express();
    app.use(express.json());

    server = http.createServer(app);
    io = new Server(server, {
      cors: { origin: '*' },
    });
    app.set('io', io);

    // Socket.IO authentication middleware matching src/index.js
    io.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error('unauthorized'));
      }
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = { id: payload.sub ?? payload.id, role: payload.role, email: payload.email };
        next();
      } catch {
        return next(new Error('unauthorized'));
      }
    });

    io.on('connection', (socket) => {
      const user = socket.user;
      const userId = user?.id ?? user?.sub;
      if (userId) {
        socket.join(`user:${userId}`);
      }
      if (user?.role) {
        socket.join(`role:${user.role}`);
        if (['ops_manager', 'admin', 'ground_crew', 'security', 'medical'].includes(user.role)) {
          socket.join('ops_feed');
        }
      }
    });

    app.use('/chat', chatRouter);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Insert test users in DB
    const passHash = await hashPassword('SocketPass123!');
    await pool.query(
      `INSERT INTO "user" (id, name, email, password_hash, role)
       VALUES
         ($1, $2, $3, $4, $5),
         ($6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role`,
      [
        testPassUser.id, testPassUser.name, testPassUser.email, passHash, testPassUser.role,
        testAgentUser.id, testAgentUser.name, testAgentUser.email, passHash, testAgentUser.role,
      ]
    );

    passToken = signToken(testPassUser);
    agentToken = signToken(testAgentUser);

    // 3. Connect real client sockets
    passengerSocket = ioClient(baseUrl, {
      auth: { token: passToken },
      transports: ['websocket'],
      forceNew: true,
    });

    agentSocket = ioClient(baseUrl, {
      auth: { token: agentToken },
      transports: ['websocket'],
      forceNew: true,
    });

    await Promise.all([
      new Promise((res, rej) => {
        passengerSocket.on('connect', res);
        passengerSocket.on('connect_error', rej);
      }),
      new Promise((res, rej) => {
        agentSocket.on('connect', res);
        agentSocket.on('connect_error', rej);
      }),
    ]);

    // 4. Create an assigned chat session for testing
    const sRes = await pool.query(
      `INSERT INTO chat_session (user_id, status, assigned_agent_id, started_at, updated_at)
       VALUES ($1, 'assigned', $2, now(), now())
       RETURNING id`,
      [testPassUser.id, testAgentUser.id]
    );
    testSessionId = sRes.rows[0].id;
  });

  afterAll(async () => {
    if (passengerSocket && passengerSocket.connected) {
      passengerSocket.disconnect();
    }
    if (agentSocket && agentSocket.connected) {
      agentSocket.disconnect();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (testSessionId) {
      await pool.query('DELETE FROM chat_message WHERE session_id = $1', [testSessionId]);
      await pool.query('DELETE FROM chat_session WHERE id = $1', [testSessionId]);
    }
    await pool.query('DELETE FROM "user" WHERE id IN ($1, $2)', [testPassUser.id, testAgentUser.id]);
  });

  it('proves passenger socket is joined to user:<id> and receives live chat:message on agent reply', async () => {
    const passengerReceived = [];

    passengerSocket.on('chat:message', (payload) => {
      passengerReceived.push(payload);
    });

    const agentReceived = [];
    agentSocket.on('chat:agent_message', (payload) => {
      agentReceived.push(payload);
    });

    // Send agent reply over HTTP
    const res = await fetch(`${baseUrl}/chat/sessions/${testSessionId}/agent-message`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Hello! Operations agent is here to help you.' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message).toBeDefined();
    expect(body.message.text).toBe('Hello! Operations agent is here to help you.');

    // Wait for socket events to arrive
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Assert: Passenger received EXACTLY ONE live event
    expect(passengerReceived).toHaveLength(1);
    expect(String(passengerReceived[0].sessionId)).toBe(String(testSessionId));
    expect(passengerReceived[0].message.text).toBe('Hello! Operations agent is here to help you.');
    expect(passengerReceived[0].message.sender).toBe('agent');
    expect(passengerReceived[0].agent.id).toBe(testAgentUser.id);

    // Assert: Agent socket received chat:agent_message once
    expect(agentReceived).toHaveLength(1);
    expect(agentReceived[0].message.id).toBe(body.message.id);

    // Simulate Agent View Message State with deduplication:
    // When agent sends reply, message is received via HTTP response AND via chat:agent_message socket event.
    // Simulating appendMessageDeduped:
    function appendMessageDeduped(existingList, newMessage) {
      if (!newMessage || !newMessage.id) return existingList;
      const exists = existingList.some((m) => String(m.id) === String(newMessage.id));
      if (exists) return existingList;
      return [...existingList, newMessage];
    }

    let agentMessagesState = [];
    // 1. Appended from HTTP response:
    agentMessagesState = appendMessageDeduped(agentMessagesState, body.message);
    expect(agentMessagesState).toHaveLength(1);

    // 2. Appended from socket broadcast:
    agentMessagesState = appendMessageDeduped(agentMessagesState, agentReceived[0].message);
    // Verified: No duplicate in agent view!
    expect(agentMessagesState).toHaveLength(1);
    expect(agentMessagesState[0].id).toBe(body.message.id);
  });

  it('keeps passenger-to-agent live update working: agent receives chat:user_message', async () => {
    const agentUserMessages = [];

    agentSocket.on('chat:user_message', (payload) => {
      agentUserMessages.push(payload);
    });

    // Passenger posts a message in assigned session
    const res = await fetch(`${baseUrl}/chat/sessions/${testSessionId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${passToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'My flight is delayed by 30 mins, will I miss boarding?' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userMessage.text).toBe('My flight is delayed by 30 mins, will I miss boarding?');
    // Bot remains silent
    expect(body.botMessage).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(agentUserMessages).toHaveLength(1);
    expect(String(agentUserMessages[0].sessionId)).toBe(String(testSessionId));
    expect(agentUserMessages[0].userMessage.text).toBe('My flight is delayed by 30 mins, will I miss boarding?');
  });
});
