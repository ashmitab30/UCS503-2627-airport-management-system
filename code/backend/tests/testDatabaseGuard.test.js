import { assertTestDatabaseSafe, getDatabaseNameFromUrl, pool } from '../src/db/pool.js';

describe('Test Database Safety Guard Tests', () => {
  describe('assertTestDatabaseSafe function', () => {
    it('throws error when test database name is missing or null', () => {
      expect(() => assertTestDatabaseSafe(null, 'airport_db')).toThrow(
        /No test database name specified/i
      );
      expect(() => assertTestDatabaseSafe('', 'airport_db')).toThrow(
        /No test database name specified/i
      );
    });

    it('throws error when test database name matches development database name', () => {
      expect(() => assertTestDatabaseSafe('airport_db', 'airport_db')).toThrow(
        /matches development database name/i
      );
    });

    it('throws error when test database name does not end with _test', () => {
      expect(() => assertTestDatabaseSafe('airport_production', 'airport_db')).toThrow(
        /does not end with "_test"/i
      );
      expect(() => assertTestDatabaseSafe('airport_dev', 'airport_db')).toThrow(
        /does not end with "_test"/i
      );
      expect(() => assertTestDatabaseSafe('my_database', 'airport_db')).toThrow(
        /does not end with "_test"/i
      );
    });

    it('accepts valid test database names ending with _test and different from dev DB', () => {
      expect(() => assertTestDatabaseSafe('airport_test', 'airport_db')).not.toThrow();
      expect(() => assertTestDatabaseSafe('myapp_ci_test', 'myapp_development')).not.toThrow();
    });
  });

  describe('getDatabaseNameFromUrl helper', () => {
    it('extracts database name from standard postgres URLs', () => {
      expect(getDatabaseNameFromUrl('postgres://user:pass@localhost:5432/airport_test')).toBe('airport_test');
      expect(getDatabaseNameFromUrl('postgresql://user:pass@localhost:5432/custom_db_test?sslmode=disable')).toBe('custom_db_test');
    });

    it('returns null for empty or invalid inputs', () => {
      expect(getDatabaseNameFromUrl(null)).toBeNull();
      expect(getDatabaseNameFromUrl('')).toBeNull();
    });
  });

  describe('Active Pool Safety Verification', () => {
    it('active test pool is connected to a database ending with _test', async () => {
      const res = await pool.query('SELECT current_database() AS db_name');
      const dbName = res.rows[0].db_name;
      expect(dbName).toMatch(/_test$/);
      expect(dbName).not.toBe('airport_db');
    });
  });
});
