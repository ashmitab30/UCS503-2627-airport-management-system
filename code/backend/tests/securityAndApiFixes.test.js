import http from 'http';
import ioClient from 'socket.io-client';
import { app, server, io } from '../src/index.js';
import { signToken } from '../src/utils/jwt.js';
import { pool } from '../src/db/pool.js';
import { runSeed } from '../scripts/seed.js';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

describe('Security, Error Handling, API Root, and Socket Tests', () => {
  let baseUrl;
  let testServer;
  let clientSockets = [];

  beforeAll(async () => {
    await new Promise((resolve) => {
      testServer = server.listen(0, '127.0.0.1', () => {
        const port = testServer.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    clientSockets.forEach((s) => {
      if (s.connected) s.disconnect();
    });
    await new Promise((resolve) => testServer.close(resolve));
  });

  describe('404 JSON Handler', () => {
    it('returns { error: "Not found" } and 404 status for unknown routes', async () => {
      const res = await fetch(`${baseUrl}/this-route-definitely-does-not-exist`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');

      const data = await res.json();
      expect(data).toEqual({ error: 'Not found' });
    });

    it('returns 404 for arbitrary POST on unknown endpoint', async () => {
      const res = await fetch(`${baseUrl}/another/random/nested/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 123 }),
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data).toEqual({ error: 'Not found' });
    });
  });

  describe('Central Error Handler', () => {
    it('returns generic message with errorId and suppresses err.message', async () => {
      const res = await fetch(`${baseUrl}/test-error-trigger`);
      expect(res.status).toBe(500);

      const data = await res.json();
      expect(data.error).toBe('Internal server error');
      expect(data.errorId).toBeDefined();
      expect(typeof data.errorId).toBe('string');
      expect(data.errorId.length).toBeGreaterThan(0);

      // Verify internal message is NOT returned to client
      expect(JSON.stringify(data)).not.toContain('secret_pass_123');
      expect(JSON.stringify(data)).not.toContain('Sensitive database leak');
    });
  });

  describe('API Root', () => {
    it('returns the real modules and version matching package.json', async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.message).toBe('Airport Management System API');
      expect(data.status).toBe('operational');
      expect(data.version).toBe(pkg.version);

      const expectedModules = [
        'health',
        'auth',
        'employees',
        'shifts',
        'attendance',
        'airports',
        'aircraft-types',
        'gates',
        'flights',
        'turnaround',
        'resources',
        'resource-assignments',
        'bookings',
        'emergencies',
        'tracking',
        'connections',
        'verify',
        'gate',
        'baggage',
        'parking',
        'security',
        'facilities',
        'chat',
      ];
      expect(data.modules).toEqual(expectedModules);
    });
  });

  describe('Socket.IO Authentication and Room Subscriptions', () => {
    it('rejects connection without token with "unauthorized" error', async () => {
      const socket = ioClient(baseUrl, {
        transports: ['websocket'],
        forceNew: true,
      });
      clientSockets.push(socket);

      const err = await new Promise((resolve) => {
        socket.on('connect_error', (error) => resolve(error));
        socket.on('connect', () => resolve(null));
      });

      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('unauthorized');
      expect(socket.connected).toBe(false);
    });

    it('rejects connection with invalid token with "unauthorized" error', async () => {
      const socket = ioClient(baseUrl, {
        auth: { token: 'invalid_expired_or_fake_token' },
        transports: ['websocket'],
        forceNew: true,
      });
      clientSockets.push(socket);

      const err = await new Promise((resolve) => {
        socket.on('connect_error', (error) => resolve(error));
        socket.on('connect', () => resolve(null));
      });

      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('unauthorized');
      expect(socket.connected).toBe(false);
    });

    it('connects successfully with valid JWT token', async () => {
      const validToken = signToken({ id: 'user_test_socket_1', role: 'passenger', email: 'passenger@meridian.com' });
      const socket = ioClient(baseUrl, {
        auth: { token: validToken },
        transports: ['websocket'],
        forceNew: true,
      });
      clientSockets.push(socket);

      const connected = await new Promise((resolve) => {
        socket.on('connect', () => resolve(true));
        socket.on('connect_error', (e) => resolve(e));
      });

      expect(connected).toBe(true);
      expect(socket.connected).toBe(true);
    });

    it('subscribe_flight only joins room when flight exists in database', async () => {
      const validToken = signToken({ id: 'user_test_socket_2', role: 'passenger', email: 'passenger2@meridian.com' });
      const socket = ioClient(baseUrl, {
        auth: { token: validToken },
        transports: ['websocket'],
        forceNew: true,
      });
      clientSockets.push(socket);

      await new Promise((resolve) => socket.on('connect', resolve));

      // Retrieve an existing server socket instance
      const serverSockets = Array.from(io.sockets.sockets.values());
      const serverSocket = serverSockets.find((s) => s.user?.id === 'user_test_socket_2');
      expect(serverSocket).toBeDefined();

      // 1. Attempt subscribing to a flight that does NOT exist
      const fakeFlightId = '00000000-0000-0000-0000-000000000000';
      socket.emit('subscribe_flight', fakeFlightId);

      // Wait a tick for async query
      await new Promise((r) => setTimeout(r, 100));
      expect(serverSocket.rooms.has(`flight:${fakeFlightId}`)).toBe(false);

      // 2. Query an existing flight from the test db or insert one
      let existingFlightId;
      try {
        const { rows } = await pool.query('SELECT id FROM flight LIMIT 1');
        if (rows.length > 0) {
          existingFlightId = rows[0].id;
        }
      } catch {
        // In case flight table isn't populated yet, we can mock or insert
      }

      if (existingFlightId) {
        socket.emit('subscribe_flight', existingFlightId);
        await new Promise((r) => setTimeout(r, 150));
        expect(serverSocket.rooms.has(`flight:${existingFlightId}`)).toBe(true);
      }
    });
  });

  describe('Seed Script Production Guard', () => {
    it('refuses to run when NODE_ENV=production unless force is passed', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        await expect(runSeed({ force: false, endPool: false })).rejects.toThrow(
          /Refusing to run seed script in production without --force/i
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('Missing TEST_DATABASE_URL Guard in globalSetup', () => {
    it('globalSetup fails with clear error if TEST_DATABASE_URL is missing', async () => {
      const originalUrl = process.env.TEST_DATABASE_URL;
      try {
        delete process.env.TEST_DATABASE_URL;
        const globalSetupModule = await import('./globalSetup.js');
        const globalSetup = globalSetupModule.default;
        await expect(globalSetup()).rejects.toThrow(
          /TEST_DATABASE_URL environment variable is required to run tests/i
        );
      } finally {
        process.env.TEST_DATABASE_URL = originalUrl;
      }
    });
  });
});
