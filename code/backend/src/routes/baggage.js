import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { BAGGAGE_STAFF_ROLES } from '../constants/index.js';
import {
  getBaggageByTag,
  updateBaggageStatus,
  listBaggage,
} from '../services/baggageService.js';

const getIo = (req) => req?.app?.get?.('io');

export const baggageRouter = Router();

// All baggage endpoints require staff role (ground_crew, ops_manager, admin)
baggageRouter.use(authenticate, requireRole(...BAGGAGE_STAFF_ROLES));

// GET /baggage — list baggage with status, flight, tag, and booking_ref filters + pagination
baggageRouter.get('/', async (req, res) => {
  const { status, flight_id, flightId, tag, booking_ref, bookingRef, page = 1, limit = 20 } = req.query;

  try {
    const result = await listBaggage({
      status,
      flightId: flight_id || flightId,
      tag,
      bookingRef: booking_ref || bookingRef,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
    });
    res.json(result);
  } catch (err) {
    console.error('list baggage error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Could not list baggage' });
  }
});

// GET /baggage/:tag — full details and scan history for a bag by tag number
baggageRouter.get('/:tag', async (req, res) => {
  const { tag } = req.params;
  if (!tag) {
    return res.status(400).json({ error: 'Tag number is required' });
  }

  try {
    const bag = await getBaggageByTag(tag.trim());
    if (!bag) {
      return res.status(404).json({ error: 'Baggage not found' });
    }
    res.json(bag);
  } catch (err) {
    console.error('get baggage by tag error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Could not retrieve baggage' });
  }
});

// PATCH /baggage/:id/status — advance baggage status in pipeline with required location
baggageRouter.patch('/:id/status', async (req, res) => {
  const baggageId = parseInt(req.params.id, 10);
  if (isNaN(baggageId)) {
    return res.status(400).json({ error: 'Invalid baggage ID' });
  }

  const { status, location } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }
  if (!location || !String(location).trim()) {
    return res.status(400).json({ error: 'Location is required' });
  }

  try {
    const result = await updateBaggageStatus({
      baggageId,
      status,
      location,
      scannedBy: req.user.id,
      io: getIo(req),
    });
    res.json(result);
  } catch (err) {
    console.error('update baggage status error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Could not update baggage status' });
  }
});
