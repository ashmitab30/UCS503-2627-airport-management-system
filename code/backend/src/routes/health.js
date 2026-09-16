import { Router } from 'express';
import { checkDbConnection } from '../db/pool.js';

export const healthRouter = Router();

// GET /health
// Week 1 skeleton endpoint. Returns API status plus a DB round-trip check
// so the frontend skeleton page has something real to display, not just
// a static "ok".
healthRouter.get('/', async (req, res) => {
  const payload = {
    status: 'ok',
    service: 'airport-management-backend',
    timestamp: new Date().toISOString(),
    db: { connected: false },
  };

  try {
    const { now } = await checkDbConnection();
    payload.db = { connected: true, serverTime: now };
  } catch (err) {
    // DB may not be provisioned yet in Week 1 — don't fail the whole
    // health check, just report it honestly.
    payload.db = { connected: false, error: err.message };
  }

  res.json(payload);
});
