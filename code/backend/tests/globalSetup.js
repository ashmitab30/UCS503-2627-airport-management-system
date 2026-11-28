import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

export default async function globalSetup() {
  process.env.NODE_ENV = 'test';
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL environment variable is required to run tests. Please configure it in your test environment or .env file.');
  }

  const testUrl = process.env.TEST_DATABASE_URL;

  // Extract test db name
  let testDbName = 'airport_test';
  try {
    const parsed = new URL(testUrl);
    testDbName = parsed.pathname.replace(/^\//, '') || 'airport_test';
  } catch {
    const match = testUrl.match(/\/([^/?#]+)(?:\?.*)?$/);
    if (match) testDbName = match[1];
  }

  // Safety guard check: refuse to run against a non-test database
  const { pool, getDatabaseNameFromUrl, assertTestDatabaseSafe } = await import('../src/db/pool.js');
  const devDbName = getDatabaseNameFromUrl(process.env.DATABASE_URL) || process.env.PGDATABASE || 'airport_db';
  assertTestDatabaseSafe(testDbName, devDbName);

  // 1. Connect to postgres maintenance DB to verify airport_test exists
  let maintenanceUrl;
  try {
    const parsed = new URL(testUrl);
    parsed.pathname = '/postgres';
    maintenanceUrl = parsed.toString();
  } catch {
    maintenanceUrl = testUrl.replace(new RegExp(`/${testDbName}(?:\\?.*)?$`), '/postgres');
  }

  const maintClient = new Client({ connectionString: maintenanceUrl });
  try {
    await maintClient.connect();
    const checkRes = await maintClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [testDbName]);
    if (checkRes.rows.length === 0) {
      console.log(`[globalSetup] Creating test database "${testDbName}"...`);
      await maintClient.query(`CREATE DATABASE "${testDbName}"`);
      console.log(`[globalSetup] Database "${testDbName}" created.`);
    }
  } catch (err) {
    console.error('[globalSetup] Error verifying/creating test database:', err.message);
    throw err;
  } finally {
    await maintClient.end();
  }

  // 2. Now run migrations and seed
  const { runMigrations } = await import('../scripts/migrate.js');
  const { runSeed } = await import('../scripts/seed.js');

  console.log(`[globalSetup] Running migrations on "${testDbName}"...`);
  await runMigrations();

  console.log(`[globalSetup] Running seed on "${testDbName}"...`);
  await runSeed({ endPool: false });

  await pool.end();
  console.log('[globalSetup] Test database setup complete.');
}
