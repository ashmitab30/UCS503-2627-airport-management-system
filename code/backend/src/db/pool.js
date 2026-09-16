import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// A single shared pool. Every module (Ops Core, Booking, Baggage, etc.)
// imports this rather than opening its own connection — this IS the
// "one shared operational data layer" from the architecture doc, made
// concrete in code.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Fallback to discrete vars if DATABASE_URL isn't set (handy locally)
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});

export async function checkDbConnection() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW() as now');
    return { ok: true, now: result.rows[0].now };
  } finally {
    client.release();
  }
}
