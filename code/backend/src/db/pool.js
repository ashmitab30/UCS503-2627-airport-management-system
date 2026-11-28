import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export function getDatabaseNameFromUrl(urlString) {
  if (!urlString) return null;
  try {
    const parsed = new URL(urlString);
    const name = parsed.pathname.replace(/^\//, '');
    return name || null;
  } catch {
    const match = String(urlString).match(/\/([^/?#]+)(?:\?.*)?$/);
    return match ? match[1] : null;
  }
}

export function assertTestDatabaseSafe(testDbName, devDbName) {
  if (!testDbName) {
    throw new Error('Test database safety check failed: No test database name specified.');
  }
  if (devDbName && testDbName === devDbName) {
    throw new Error(
      `Test database safety check failed: Test database name "${testDbName}" matches development database name "${devDbName}". Refusing to run tests against development database.`
    );
  }
  if (!testDbName.endsWith('_test')) {
    throw new Error(
      `Test database safety check failed: Test database name "${testDbName}" does not end with "_test". Refusing to run tests against non-test database.`
    );
  }
}

const isTest = process.env.NODE_ENV === 'test';

let poolConfig;

if (isTest) {
  const testUrl = process.env.TEST_DATABASE_URL;
  const devDbName = getDatabaseNameFromUrl(process.env.DATABASE_URL) || process.env.PGDATABASE || 'airport_db';
  const testDbName = getDatabaseNameFromUrl(testUrl) || process.env.PGDATABASE_TEST;

  assertTestDatabaseSafe(testDbName, devDbName);

  poolConfig = {
    connectionString: testUrl,
  };
} else {
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    // Fallback to discrete vars if DATABASE_URL isn't set (handy locally)
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
  };
}

// A single shared pool. Every module (Ops Core, Booking, Baggage, etc.)
// imports this rather than opening its own connection — this IS the
// "one shared operational data layer" from the architecture doc, made
// concrete in code.
export const pool = new Pool(poolConfig);

export async function checkDbConnection() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW() as now');
    return { ok: true, now: result.rows[0].now };
  } finally {
    client.release();
  }
}
