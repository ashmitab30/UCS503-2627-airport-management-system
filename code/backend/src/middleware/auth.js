import { verifyToken } from '../utils/jwt.js';

// Attaches req.user = { id, role, email } if a valid Bearer token is
// present. Does NOT reject the request on its own — pair it with
// requireAuth or requireRole below depending on the route.
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    req.user = null;
    return next();
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
  } catch (err) {
    // Expired or tampered token — treat as unauthenticated rather than
    // crashing the request; requireAuth will turn this into a 401.
    req.user = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// requireRole('admin') or requireRole('admin', 'ops_manager') — any match passes.
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        detail: `Requires role: ${allowedRoles.join(' or ')}`,
      });
    }
    next();
  };
}
