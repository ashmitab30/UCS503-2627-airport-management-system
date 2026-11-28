/**
 * format.js — Single source of truth for date, time, and INR currency formatting.
 *
 * Rules:
 * - formatINR: Indian grouping with ₹ and no decimals when whole (₹4,500),
 *   paise input (1 rupee = 100 paise). Handles null/undefined/NaN safely (returns "—").
 * - formatDate: e.g. "Sat, 28 Nov 2026" in browser's local time zone.
 * - formatTime: 24-hour "14:30" in browser's local time zone.
 * - formatDateTime: "28 Nov 2026, 14:30" in browser's local time zone.
 * - dayOffsetLabel: returns "+1 day" (or "+N days") when arrival is on a later
 *   calendar day than departure in local time, else "".
 */

function toValidDate(d) {
  if (d === null || d === undefined || d === '') return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Format paise into Indian Rupee currency string.
 * e.g. 450000 -> "₹4,500"
 *      1234567 -> "₹12,345.67"
 *      0 -> "₹0"
 *      null/undefined/NaN -> "—"
 * @param {number|string} paise
 * @returns {string}
 */
export function formatINR(paise) {
  if (paise === null || paise === undefined || paise === '') return '—';
  const num = Number(paise);
  if (Number.isNaN(num)) return '—';
  const rupees = num / 100;
  const isWhole = rupees % 1 === 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 2,
  }).format(rupees);
}

/**
 * Format ISO string / Date into "Sat, 28 Nov 2026".
 * @param {string|Date} iso
 * @returns {string}
 */
export function formatDate(iso) {
  const d = toValidDate(iso);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/**
 * Format ISO string / Date into 24-hour time "14:30".
 * @param {string|Date} iso
 * @returns {string}
 */
export function formatTime(iso) {
  const d = toValidDate(iso);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Format ISO string / Date into "28 Nov 2026, 14:30".
 * @param {string|Date} iso
 * @returns {string}
 */
export function formatDateTime(iso) {
  const d = toValidDate(iso);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Return "+1 day" (or "+N days") when arrival calendar date is later than departure calendar date.
 * Returns "" if same day, earlier, or if inputs are invalid.
 * @param {string|Date} depIso
 * @param {string|Date} arrIso
 * @returns {string}
 */
/**
 * Format fare difference in paise into readable label.
 * e.g. 120000 -> "Extra to pay ₹1,200"
 *     -80000  -> "Refund ₹800"
 *      0      -> "No fare difference"
 *      null   -> "No fare difference"
 * @param {number|string} diffPaise
 * @returns {string}
 */
export function formatFareDifference(diffPaise) {
  if (diffPaise === null || diffPaise === undefined || diffPaise === '') {
    return 'No fare difference';
  }
  const num = Number(diffPaise);
  if (Number.isNaN(num) || num === 0) {
    return 'No fare difference';
  }
  const absFormatted = formatINR(Math.abs(num));
  if (num > 0) {
    return `Extra to pay ${absFormatted}`;
  }
  return `Refund ${absFormatted}`;
}

export function dayOffsetLabel(depIso, arrIso) {
  const dep = toValidDate(depIso);
  const arr = toValidDate(arrIso);
  if (!dep || !arr) return '';
  const depDate = new Date(dep.getFullYear(), dep.getMonth(), dep.getDate());
  const arrDate = new Date(arr.getFullYear(), arr.getMonth(), arr.getDate());
  const diffDays = Math.round((arrDate - depDate) / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return '+1 day';
  if (diffDays > 1) return `+${diffDays} days`;
  return '';
}
