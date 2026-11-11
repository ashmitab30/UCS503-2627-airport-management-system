import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../migrations');

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows: appliedRows } = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(appliedRows.map((r) => r.version));

    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found.');
      return [];
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const appliedThisRun = [];

    for (const file of files) {
      if (appliedSet.has(file)) {
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        appliedThisRun.push(file);
        console.log(`✓ Applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗ Error applying migration ${file}:`, err.message);
        throw err;
      }
    }

    if (appliedThisRun.length === 0) {
      console.log('Database is up to date. No pending migrations.');
    }

    return appliedThisRun;
  } finally {
    client.release();
  }
}

// Direct execution from CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runMigrations()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Migration failed:', err);
      await pool.end();
      process.exit(1);
    });
}
