import express from 'express';
import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db/pool.js';
import { airportsRouter } from '../src/routes/airports.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedScriptPath = path.resolve(__dirname, '../scripts/seed.js');

describe('Task 3: Airport City & Seed Idempotency Tests', () => {
  let server;
  let baseUrl;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use('/airports', airportsRouter);

    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  describe('GET /airports Route', () => {
    it('returns airports including the city field alongside id, name, code, and timezone', async () => {
      const res = await fetch(`${baseUrl}/airports`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty('airports');
      expect(Array.isArray(data.airports)).toBe(true);
      expect(data.airports.length).toBeGreaterThanOrEqual(11);

      // Verify that all returned airports have the required fields including city
      data.airports.forEach((airport) => {
        expect(airport).toHaveProperty('id');
        expect(airport).toHaveProperty('name');
        expect(airport).toHaveProperty('code');
        expect(airport).toHaveProperty('timezone');
        expect(airport).toHaveProperty('city');
        expect(typeof airport.code).toBe('string');
        expect(airport.code).toHaveLength(3);
      });

      // Verify specific seeded cities
      const airportMap = new Map(data.airports.map((a) => [a.code, a]));
      expect(airportMap.get('DEL')?.city).toBe('Delhi');
      expect(airportMap.get('BOM')?.city).toBe('Mumbai');
      expect(airportMap.get('BLR')?.city).toBe('Bengaluru');
      expect(airportMap.get('MAA')?.city).toBe('Chennai');
      expect(airportMap.get('HYD')?.city).toBe('Hyderabad');
      expect(airportMap.get('CCU')?.city).toBe('Kolkata');
      expect(airportMap.get('GOI')?.city).toBe('Goa');
      expect(airportMap.get('AMD')?.city).toBe('Ahmedabad');
      expect(airportMap.get('PNQ')?.city).toBe('Pune');
      expect(airportMap.get('COK')?.city).toBe('Kochi');
      expect(airportMap.get('JAI')?.city).toBe('Jaipur');
    });
  });

  describe('Seed Script Idempotency', () => {
    it('running seed again does not duplicate airports or flights', async () => {
      // 1. Snapshot initial counts
      const apCountBefore = await pool.query('SELECT count(*)::int AS count FROM airport');
      const flightCountBefore = await pool.query('SELECT count(*)::int AS count FROM flight');

      expect(apCountBefore.rows[0].count).toBeGreaterThanOrEqual(11);
      expect(flightCountBefore.rows[0].count).toBeGreaterThanOrEqual(15);

      // 2. Re-run seed script
      const { stdout, stderr } = await execFileAsync('node', [seedScriptPath], {
        cwd: path.resolve(__dirname, '..'),
      });
      expect(stdout).toContain('Seed complete.');

      // 3. Snapshot counts after re-run
      const apCountAfter = await pool.query('SELECT count(*)::int AS count FROM airport');
      const flightCountAfter = await pool.query('SELECT count(*)::int AS count FROM flight');

      // 4. Must not have duplicated any airport or flight
      expect(apCountAfter.rows[0].count).toBe(apCountBefore.rows[0].count);
      expect(flightCountAfter.rows[0].count).toBe(flightCountBefore.rows[0].count);

      // 5. Ensure no duplicates exist in DB
      const dupAirports = await pool.query(
        'SELECT code, count(*)::int AS cnt FROM airport GROUP BY code HAVING count(*) > 1'
      );
      expect(dupAirports.rows).toEqual([]);

      const dupFlights = await pool.query(
        'SELECT flight_number, count(*)::int AS cnt FROM flight GROUP BY flight_number HAVING count(*) > 1'
      );
      expect(dupFlights.rows).toEqual([]);
    }, 30000);
  });
});
