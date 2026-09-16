const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Every module's frontend calls funnel through this so the JWT header
// and JSON error handling only live in one place. Later weeks (Booking,
// Ops Core, etc.) reuse this exact function.
export async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 204 No Content has no body to parse
  const data = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.error || `Request failed: ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.detail = data;
    throw error;
  }
  return data;
}
