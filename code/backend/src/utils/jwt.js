import jwt from 'jsonwebtoken';
import 'dotenv/config';

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

if (!SECRET || SECRET === 'change_me_before_week_2') {
  // Loud on purpose. A default/missing secret is the #1 way auth
  // silently becomes worthless in a school project demo.
  console.warn(
    '[auth] WARNING: JWT_SECRET is unset or still the placeholder value. ' +
    'Set a real secret in backend/.env before demoing auth.'
  );
}

export function signToken(user) {
  // Keep the payload small — id + role is all any route needs.
  // Never put password_hash or anything sensitive in here; JWTs are
  // base64, not encrypted, and are readable by anyone holding the token.
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET); // throws on invalid/expired
}
