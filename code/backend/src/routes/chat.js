import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { authenticate, requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { SUPPORT_AGENT_ROLES } from '../constants/index.js';
import { processChatbotMessage } from '../services/chatbot/chatbotService.js';

export const chatRouter = Router();

const getIo = (req) => req?.app?.get?.('io');

// All chat routes require authentication
chatRouter.use(authenticate, requireAuth);

// Rate limiter for chat messages: 30 messages per minute per user
const chatMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => String(req.user?.id || 'anonymous'),
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Please wait a moment before sending more messages.' },
});

// Zod schemas
const sendMessageSchema = z.object({
  text: z
    .string({ required_error: 'Message text is required' })
    .trim()
    .min(1, 'Message cannot be empty')
    .max(500, 'Message cannot exceed 500 characters'),
});

const sessionIdParamSchema = z.object({
  id: z.coerce.number().int().positive('Invalid session ID'),
});

const escalationsQuerySchema = z.object({
  status: z.enum(['escalated', 'assigned', 'all']).optional().default('all'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ============================================================================
// PASSENGER / GENERAL ROUTES
// ============================================================================

/**
 * POST /chat/sessions — get or create an active chat session for the logged-in user.
 */
chatRouter.post('/sessions', async (req, res) => {
  const userId = req.user.id;

  try {
    // Check if user already has an open session (active, escalated, or assigned)
    const existingRes = await pool.query(
      `SELECT id, user_id, status, assigned_agent_id, started_at, closed_at, updated_at
         FROM chat_session
        WHERE user_id = $1
          AND status IN ('active', 'escalated', 'assigned')
        ORDER BY updated_at DESC
        LIMIT 1`,
      [userId]
    );

    if (existingRes.rows.length > 0) {
      return res.json({ session: existingRes.rows[0] });
    }

    // Create a new active session
    const insRes = await pool.query(
      `INSERT INTO chat_session (user_id, status, started_at, updated_at)
       VALUES ($1, 'active', now(), now())
       RETURNING id, user_id, status, assigned_agent_id, started_at, closed_at, updated_at`,
      [userId]
    );

    res.status(201).json({ session: insRes.rows[0] });
  } catch (err) {
    console.error('get/create chat session error:', err.message);
    res.status(500).json({ error: 'Could not initialize chat session' });
  }
});

/**
 * GET /chat/sessions/mine — fetch current user's active session and message history.
 */
chatRouter.get('/sessions/mine', async (req, res) => {
  const userId = req.user.id;

  try {
    // Fetch latest session for user
    const sessionRes = await pool.query(
      `SELECT s.id, s.user_id, s.status, s.assigned_agent_id, s.started_at, s.closed_at, s.updated_at,
              u.name AS agent_name
         FROM chat_session s
    LEFT JOIN "user" u ON u.id = s.assigned_agent_id
        WHERE s.user_id = $1
        ORDER BY s.updated_at DESC
        LIMIT 1`,
      [userId]
    );

    if (sessionRes.rows.length === 0) {
      return res.json({ session: null, messages: [] });
    }

    const session = sessionRes.rows[0];

    const messagesRes = await pool.query(
      `SELECT id, session_id, sender, text, intent, "timestamp"
         FROM chat_message
        WHERE session_id = $1
        ORDER BY "timestamp" ASC`,
      [session.id]
    );

    res.json({
      session,
      messages: messagesRes.rows,
    });
  } catch (err) {
    console.error('get mine chat error:', err.message);
    res.status(500).json({ error: 'Could not fetch current chat session' });
  }
});

/**
 * POST /chat/sessions/:id/messages — send user message and generate rule-based bot reply.
 */
chatRouter.post(
  '/sessions/:id/messages',
  chatMessageLimiter,
  validate({ params: sessionIdParamSchema, body: sendMessageSchema }),
  async (req, res) => {
    const sessionId = req.params.id;
    const { text } = req.body;
    const userId = req.user.id;

    try {
      // 1. Verify session exists & user ownership
      const sessionRes = await pool.query(
        `SELECT id, user_id, status, assigned_agent_id, started_at, closed_at, updated_at
           FROM chat_session
          WHERE id = $1`,
        [sessionId]
      );

      if (sessionRes.rows.length === 0) {
        return res.status(404).json({ error: 'Chat session not found' });
      }

      const session = sessionRes.rows[0];

      if (session.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden: You do not own this chat session' });
      }

      if (session.status === 'closed') {
        return res.status(400).json({ error: 'This chat session is closed. Please start a new session.' });
      }

      // 2. Insert user message
      const userMsgRes = await pool.query(
        `INSERT INTO chat_message (session_id, sender, text, intent, "timestamp")
         VALUES ($1, 'user', $2, NULL, now())
         RETURNING id, session_id, sender, text, intent, "timestamp"`,
        [sessionId, text]
      );
      const userMessage = userMsgRes.rows[0];

      // Update session updated_at
      await pool.query('UPDATE chat_session SET updated_at = now() WHERE id = $1', [sessionId]);

      const io = getIo(req);

      // 3. If session is assigned, the bot stays silent. Forward message to agent.
      if (session.status === 'assigned') {
        if (io) {
          const agentRooms = ['role:ground_crew', 'role:ops_manager', 'role:admin'];
          if (session.assigned_agent_id) {
            agentRooms.push(`user:${session.assigned_agent_id}`);
          }
          io.to(agentRooms).emit('chat:user_message', {
            sessionId: session.id,
            userMessage,
          });
        }

        return res.json({
          userMessage,
          botMessage: null,
          session,
        });
      }

      // 4. Process user message through Intent Engine
      const { intent, replyText, shouldEscalate } = await processChatbotMessage({
        text,
        user: req.user,
        sessionId: session.id,
      });

      // 5. Insert bot reply
      const botMsgRes = await pool.query(
        `INSERT INTO chat_message (session_id, sender, text, intent, "timestamp")
         VALUES ($1, 'bot', $2, $3, now())
         RETURNING id, session_id, sender, text, intent, "timestamp"`,
        [sessionId, replyText, intent]
      );
      const botMessage = botMsgRes.rows[0];

      let updatedSession = session;

      // 6. Escalation handling
      if (shouldEscalate && session.status !== 'escalated') {
        const escRes = await pool.query(
          `UPDATE chat_session
              SET status = 'escalated', updated_at = now()
            WHERE id = $1
            RETURNING id, user_id, status, assigned_agent_id, started_at, closed_at, updated_at`,
          [sessionId]
        );
        updatedSession = escRes.rows[0];

        // Fetch user info for escalation event
        const userRes = await pool.query('SELECT name, email FROM "user" WHERE id = $1', [userId]);
        const userName = userRes.rows[0]?.name || 'Passenger';

        if (io) {
          io.to(['role:ground_crew', 'role:ops_manager', 'role:admin', 'ops_feed']).emit('chat:escalated', {
            session: updatedSession,
            passenger: { id: userId, name: userName },
            lastMessage: text,
            replyText,
          });
        }
      }

      res.json({
        userMessage,
        botMessage,
        session: updatedSession,
      });
    } catch (err) {
      console.error('send message error:', err.message);
      res.status(500).json({ error: 'Could not process chat message' });
    }
  }
);

// ============================================================================
// AGENT & SHARED ACTION ROUTES
// ============================================================================

/**
 * GET /chat/escalations — list escalated and assigned chat sessions for support staff.
 */
chatRouter.get(
  '/escalations',
  requireRole(...SUPPORT_AGENT_ROLES),
  validate({ query: escalationsQuerySchema }),
  async (req, res) => {
    const { status, limit, offset } = req.query;

    try {
      const conditions = [];
      const params = [];

      if (status && status !== 'all') {
        params.push(status);
        conditions.push(`s.status = $${params.length}`);
      } else {
        conditions.push(`s.status IN ('escalated', 'assigned')`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total
      const countRes = await pool.query(
        `SELECT COUNT(*) AS total
           FROM chat_session s
          ${whereClause}`,
        params
      );
      const total = parseInt(countRes.rows[0].total, 10);

      // Fetch escalated sessions with passenger & assigned agent info
      const queryParams = [...params, limit, offset];
      const dataRes = await pool.query(
        `SELECT s.id, s.user_id, s.status, s.assigned_agent_id, s.started_at, s.closed_at, s.updated_at,
                u.name AS passenger_name, u.email AS passenger_email,
                a.name AS agent_name,
                (SELECT text FROM chat_message WHERE session_id = s.id ORDER BY "timestamp" DESC LIMIT 1) AS last_message_text,
                (SELECT "timestamp" FROM chat_message WHERE session_id = s.id ORDER BY "timestamp" DESC LIMIT 1) AS last_message_time
           FROM chat_session s
           JOIN "user" u ON u.id = s.user_id
      LEFT JOIN "user" a ON a.id = s.assigned_agent_id
          ${whereClause}
          ORDER BY (CASE WHEN s.status = 'escalated' THEN 0 ELSE 1 END), s.updated_at DESC
          LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
        queryParams
      );

      res.json({
        escalations: dataRes.rows,
        total,
        limit,
        offset,
      });
    } catch (err) {
      console.error('get escalations error:', err.message);
      res.status(500).json({ error: 'Could not fetch escalations' });
    }
  }
);

/**
 * GET /chat/sessions/:id — agents fetch full message transcript of any chat session.
 */
chatRouter.get(
  '/sessions/:id',
  requireRole(...SUPPORT_AGENT_ROLES),
  validate({ params: sessionIdParamSchema }),
  async (req, res) => {
    const sessionId = req.params.id;

    try {
      const sessionRes = await pool.query(
        `SELECT s.id, s.user_id, s.status, s.assigned_agent_id, s.started_at, s.closed_at, s.updated_at,
                u.name AS passenger_name, u.email AS passenger_email,
                a.name AS agent_name
           FROM chat_session s
           JOIN "user" u ON u.id = s.user_id
      LEFT JOIN "user" a ON a.id = s.assigned_agent_id
          WHERE s.id = $1`,
        [sessionId]
      );

      if (sessionRes.rows.length === 0) {
        return res.status(404).json({ error: 'Chat session not found' });
      }

      const messagesRes = await pool.query(
        `SELECT id, session_id, sender, text, intent, "timestamp"
           FROM chat_message
          WHERE session_id = $1
          ORDER BY "timestamp" ASC`,
        [sessionId]
      );

      res.json({
        session: sessionRes.rows[0],
        messages: messagesRes.rows,
      });
    } catch (err) {
      console.error('get session by id error:', err.message);
      res.status(500).json({ error: 'Could not fetch chat session details' });
    }
  }
);

/**
 * POST /chat/sessions/:id/claim — agent claims an escalated session (escalated -> assigned).
 * Second claim returns 409 Conflict.
 */
chatRouter.post(
  '/sessions/:id/claim',
  requireRole(...SUPPORT_AGENT_ROLES),
  validate({ params: sessionIdParamSchema }),
  async (req, res) => {
    const sessionId = req.params.id;
    const agentId = req.user.id;

    try {
      const checkRes = await pool.query(
        'SELECT id, user_id, status, assigned_agent_id FROM chat_session WHERE id = $1',
        [sessionId]
      );

      if (checkRes.rows.length === 0) {
        return res.status(404).json({ error: 'Chat session not found' });
      }

      const session = checkRes.rows[0];

      if (session.status === 'closed') {
        return res.status(400).json({ error: 'Cannot claim a closed chat session' });
      }

      if (session.status === 'assigned') {
        return res.status(409).json({ error: 'Session is already claimed by another agent' });
      }

      // Claim session
      const updateRes = await pool.query(
        `UPDATE chat_session
            SET status = 'assigned', assigned_agent_id = $1, updated_at = now()
          WHERE id = $2
          RETURNING id, user_id, status, assigned_agent_id, started_at, closed_at, updated_at`,
        [agentId, sessionId]
      );

      const updated = updateRes.rows[0];

      // Insert system notification message in chat
      await pool.query(
        `INSERT INTO chat_message (session_id, sender, text, intent, "timestamp")
         VALUES ($1, 'bot', $2, 'agent_joined', now())`,
        [sessionId, `${req.user.name} from Airport Support has joined the chat.`]
      );

      const io = getIo(req);
      if (io) {
        io.to(`user:${session.user_id}`).emit('chat:claimed', {
          session: updated,
          agent: { id: agentId, name: req.user.name, role: req.user.role },
        });

        io.to(['role:ground_crew', 'role:ops_manager', 'role:admin', 'ops_feed']).emit('chat:claimed', {
          session: updated,
          agent: { id: agentId, name: req.user.name, role: req.user.role },
        });
      }

      res.json({ session: updated, agent: { id: agentId, name: req.user.name } });
    } catch (err) {
      console.error('claim session error:', err.message);
      res.status(500).json({ error: 'Could not claim chat session' });
    }
  }
);

/**
 * POST /chat/sessions/:id/agent-message — human agent sends message to passenger.
 */
chatRouter.post(
  '/sessions/:id/agent-message',
  requireRole(...SUPPORT_AGENT_ROLES),
  validate({ params: sessionIdParamSchema, body: sendMessageSchema }),
  async (req, res) => {
    const sessionId = req.params.id;
    const { text } = req.body;
    const agentId = req.user.id;
    const isPrivileged = req.user.role === 'admin' || req.user.role === 'ops_manager';

    try {
      const sessionRes = await pool.query(
        'SELECT id, user_id, status, assigned_agent_id FROM chat_session WHERE id = $1',
        [sessionId]
      );

      if (sessionRes.rows.length === 0) {
        return res.status(404).json({ error: 'Chat session not found' });
      }

      const session = sessionRes.rows[0];

      if (session.status === 'closed') {
        return res.status(400).json({ error: 'Cannot send message to a closed chat session' });
      }

      // Check agent authorization: assigned agent or admin/ops_manager
      if (session.assigned_agent_id !== agentId && !isPrivileged) {
        return res.status(403).json({ error: 'Forbidden: You are not the assigned agent for this session' });
      }

      // Insert agent message
      const msgRes = await pool.query(
        `INSERT INTO chat_message (session_id, sender, text, intent, "timestamp")
         VALUES ($1, 'agent', $2, 'agent_reply', now())
         RETURNING id, session_id, sender, text, intent, "timestamp"`,
        [sessionId, text]
      );
      const agentMessage = msgRes.rows[0];

      await pool.query('UPDATE chat_session SET updated_at = now() WHERE id = $1', [sessionId]);

      const io = getIo(req);
      if (io) {
        // Emit directly to passenger user room
        io.to(`user:${session.user_id}`).emit('chat:message', {
          sessionId: session.id,
          message: agentMessage,
          agent: { id: agentId, name: req.user.name },
        });

        // Also emit to support staff rooms and ops feed
        io.to(['role:ground_crew', 'role:ops_manager', 'role:admin', 'ops_feed']).emit('chat:agent_message', {
          sessionId: session.id,
          message: agentMessage,
          agent: { id: agentId, name: req.user.name },
        });
      }

      res.status(201).json({ message: agentMessage, session });
    } catch (err) {
      console.error('send agent message error:', err.message);
      res.status(500).json({ error: 'Could not send agent message' });
    }
  }
);

/**
 * POST /chat/sessions/:id/close — close chat session (passenger or agent).
 */
chatRouter.post(
  '/sessions/:id/close',
  validate({ params: sessionIdParamSchema }),
  async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user.id;
    const isStaff = SUPPORT_AGENT_ROLES.includes(req.user.role);

    try {
      const sessionRes = await pool.query(
        'SELECT id, user_id, status, assigned_agent_id FROM chat_session WHERE id = $1',
        [sessionId]
      );

      if (sessionRes.rows.length === 0) {
        return res.status(404).json({ error: 'Chat session not found' });
      }

      const session = sessionRes.rows[0];

      // Check permission: owner passenger or staff
      if (session.user_id !== userId && !isStaff) {
        return res.status(403).json({ error: 'Forbidden: You cannot close this session' });
      }

      if (session.status === 'closed') {
        return res.json({ session, message: 'Chat session is already closed' });
      }

      const updateRes = await pool.query(
        `UPDATE chat_session
            SET status = 'closed', closed_at = now(), updated_at = now()
          WHERE id = $1
          RETURNING id, user_id, status, assigned_agent_id, started_at, closed_at, updated_at`,
        [sessionId]
      );
      const updated = updateRes.rows[0];

      // Add closure notification message
      await pool.query(
        `INSERT INTO chat_message (session_id, sender, text, intent, "timestamp")
         VALUES ($1, 'bot', $2, 'session_closed', now())`,
        [sessionId, 'This support chat session has been closed. Thank you for contacting Meridian Support!']
      );

      const io = getIo(req);
      if (io) {
        io.to(`user:${session.user_id}`).emit('chat:closed', { session: updated });
        io.to(['role:ground_crew', 'role:ops_manager', 'role:admin', 'ops_feed']).emit('chat:closed', {
          session: updated,
        });
      }

      res.json({ session: updated, message: 'Chat session closed successfully' });
    } catch (err) {
      console.error('close session error:', err.message);
      res.status(500).json({ error: 'Could not close chat session' });
    }
  }
);
