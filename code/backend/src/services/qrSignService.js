import crypto from 'crypto';

const DEFAULT_DEV_SECRET = 'meridian_qr_secret_dev_local_2026';

export function getQrSecret() {
  return process.env.QR_SIGNING_SECRET || DEFAULT_DEV_SECRET;
}

export function getPublicBaseUrl() {
  return process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
}

/**
 * Computes HMAC-SHA256 signature for a booking reference.
 */
export function signBookingRef(bookingRef, secret = getQrSecret()) {
  if (!bookingRef) throw new Error('bookingRef is required for QR signature');
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(String(bookingRef).trim().toUpperCase());
  return hmac.digest('hex');
}

/**
 * Builds the full signed verification URL for a booking reference.
 */
export function buildVerificationUrl(bookingRef, secret = getQrSecret(), baseUrl = getPublicBaseUrl()) {
  const cleanRef = String(bookingRef).trim().toUpperCase();
  const signature = signBookingRef(cleanRef, secret);
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/verify/${cleanRef}?sig=${signature}`;
}

/**
 * Validates whether a signature matches a booking reference using crypto.timingSafeEqual.
 */
export function verifyBookingSignature(bookingRef, signature, secret = getQrSecret()) {
  if (!bookingRef || !signature) return false;
  try {
    const expectedSig = signBookingRef(bookingRef, secret);
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const actualBuf = Buffer.from(String(signature).trim(), 'hex');

    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

/**
 * Parses either a full verification URL, query string, or discrete parameters into { bookingRef, sig }.
 */
export function parseVerificationInput(input) {
  if (!input) return { bookingRef: null, sig: null };

  const str = String(input).trim();

  // If full URL: http://localhost:5173/verify/BK123?sig=...
  if (str.includes('/verify/')) {
    try {
      const parsed = new URL(str);
      const match = parsed.pathname.match(/\/verify\/([^/?#]+)/i);
      const bookingRef = match ? match[1].toUpperCase() : null;
      const sig = parsed.searchParams.get('sig');
      return { bookingRef, sig };
    } catch {
      const match = str.match(/\/verify\/([^/?#&]+)[?&]sig=([^&#\s]+)/i);
      if (match) {
        return { bookingRef: match[1].toUpperCase(), sig: match[2] };
      }
    }
  }

  // If query string format: ref=BK123&sig=... or booking_ref=BK123&sig=...
  if (str.includes('sig=')) {
    const refMatch = str.match(/(?:ref|booking_ref)=([^&]+)/i);
    const sigMatch = str.match(/sig=([^&]+)/i);
    return {
      bookingRef: refMatch ? refMatch[1].toUpperCase() : null,
      sig: sigMatch ? sigMatch[1] : null,
    };
  }

  return { bookingRef: str.toUpperCase(), sig: null };
}
