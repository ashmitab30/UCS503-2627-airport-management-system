/**
 * Chatbot frontend helper functions and validation.
 */

export const QUICK_REPLY_CHIPS = [
  { label: 'My next flight', query: 'What is my next flight?', icon: 'flight_takeoff' },
  { label: 'Flight status', query: 'Status of AI-101', icon: 'info' },
  { label: 'Check-in', query: 'Can I check in?', icon: 'check_circle' },
  { label: 'Baggage', query: 'Where is my baggage?', icon: 'luggage' },
  { label: 'Boarding group', query: 'What is my boarding group?', icon: 'groups' },
  { label: 'Facilities', query: 'Where can I find a lounge or coffee?', icon: 'storefront' },
  { label: 'Parking', query: 'What are the parking rates?', icon: 'local_parking' },
];

/**
 * Validates chat input text.
 * Must be non-empty and at most 500 characters.
 */
export function validateChatMessage(text) {
  if (typeof text !== 'string') {
    return {
      isValid: false,
      error: 'Message must be text',
      trimmedText: '',
    };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      isValid: false,
      error: 'Message cannot be empty',
      trimmedText: '',
    };
  }

  if (trimmed.length > 500) {
    return {
      isValid: false,
      error: 'Message cannot exceed 500 characters',
      trimmedText: trimmed,
    };
  }

  return {
    isValid: true,
    error: null,
    trimmedText: trimmed,
  };
}

/**
 * Returns UI metadata for session status.
 */
export function getChatSessionStatusMeta(status) {
  switch (status) {
    case 'escalated':
      return {
        label: 'Waiting for Agent',
        color: '#d97706',
        bgColor: 'rgba(217, 119, 6, 0.12)',
        borderColor: 'rgba(217, 119, 6, 0.3)',
      };
    case 'assigned':
      return {
        label: 'Agent Connected',
        color: '#0284c7',
        bgColor: 'rgba(2, 132, 199, 0.12)',
        borderColor: 'rgba(2, 132, 199, 0.3)',
      };
    case 'closed':
      return {
        label: 'Closed',
        color: '#64748b',
        bgColor: 'rgba(100, 116, 139, 0.12)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
      };
    case 'active':
    default:
      return {
        label: 'Virtual Assistant',
        color: '#059669',
        bgColor: 'rgba(5, 150, 105, 0.12)',
        borderColor: 'rgba(5, 150, 105, 0.3)',
      };
  }
}

/**
 * Formats a message timestamp into HH:MM.
 */
export function formatMessageTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Deduplicates and appends a message to an existing list.
 * - If the message has no id or already exists (by string-matched id), it returns the list unchanged.
 * - If the message is new, it appends it and sorts chronologically by timestamp (handling out-of-order arrival).
 */
export function appendMessageDeduped(existingList, newMessage) {
  if (!newMessage || newMessage.id === undefined || newMessage.id === null) {
    return existingList || [];
  }
  const list = Array.isArray(existingList) ? existingList : [];
  const exists = list.some((m) => String(m.id) === String(newMessage.id));
  if (exists) {
    return list;
  }
  const updated = [...list, newMessage];
  return updated.sort((a, b) => {
    const timeA = new Date(a.timestamp || 0).getTime();
    const timeB = new Date(b.timestamp || 0).getTime();
    if (isNaN(timeA) || isNaN(timeB)) return 0;
    return timeA - timeB;
  });
}
