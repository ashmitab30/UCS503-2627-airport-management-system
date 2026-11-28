import { describe, it, expect } from 'vitest';
import {
  validateChatMessage,
  getChatSessionStatusMeta,
  formatMessageTime,
  QUICK_REPLY_CHIPS,
  appendMessageDeduped,
} from './chatHelpers.js';

describe('Task 16b: Chat Message Input Validation', () => {
  it('rejects null, undefined, and non-string values', () => {
    expect(validateChatMessage(null).isValid).toBe(false);
    expect(validateChatMessage(undefined).isValid).toBe(false);
    expect(validateChatMessage(12345).isValid).toBe(false);
    expect(validateChatMessage({}).isValid).toBe(false);
  });

  it('rejects empty and whitespace-only text', () => {
    const resEmpty = validateChatMessage('');
    expect(resEmpty.isValid).toBe(false);
    expect(resEmpty.error).toContain('cannot be empty');

    const resWhitespace = validateChatMessage('   \t\n  ');
    expect(resWhitespace.isValid).toBe(false);
    expect(resWhitespace.error).toContain('cannot be empty');
  });

  it('rejects messages exceeding 500 characters', () => {
    const longText = 'A'.repeat(501);
    const res = validateChatMessage(longText);
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('cannot exceed 500 characters');
  });

  it('accepts valid messages between 1 and 500 characters', () => {
    const res1 = validateChatMessage('Hello');
    expect(res1.isValid).toBe(true);
    expect(res1.error).toBeNull();
    expect(res1.trimmedText).toBe('Hello');

    const singleChar = validateChatMessage(' ? ');
    expect(singleChar.isValid).toBe(true);
    expect(singleChar.trimmedText).toBe('?');

    const exact500 = validateChatMessage('X'.repeat(500));
    expect(exact500.isValid).toBe(true);
    expect(exact500.trimmedText.length).toBe(500);
  });
});

describe('Task 16b: Quick-Reply Chips & Helpers', () => {
  it('contains expected quick-reply chips for key passenger intents', () => {
    const labels = QUICK_REPLY_CHIPS.map((c) => c.label);
    expect(labels).toContain('My next flight');
    expect(labels).toContain('Flight status');
    expect(labels).toContain('Baggage');
    expect(labels).toContain('Parking');
    expect(labels).toContain('Facilities');

    QUICK_REPLY_CHIPS.forEach((chip) => {
      expect(chip.label).toBeDefined();
      expect(chip.query).toBeDefined();
      expect(chip.icon).toBeDefined();
    });
  });

  it('returns appropriate session status metadata', () => {
    const escMeta = getChatSessionStatusMeta('escalated');
    expect(escMeta.label).toContain('Waiting');
    expect(escMeta.color).toBeDefined();

    const assMeta = getChatSessionStatusMeta('assigned');
    expect(assMeta.label).toContain('Agent Connected');

    const closedMeta = getChatSessionStatusMeta('closed');
    expect(closedMeta.label).toBe('Closed');

    const activeMeta = getChatSessionStatusMeta('active');
    expect(activeMeta.label).toContain('Virtual Assistant');
  });

  it('formats valid ISO timestamps to HH:MM time string', () => {
    const formatted = formatMessageTime('2026-11-25T14:30:00Z');
    expect(formatted).toMatch(/^\d{2}:\d{2}$/);
    expect(formatMessageTime(null)).toBe('');
    expect(formatMessageTime('invalid-date')).toBe('');
  });
});

describe('Task 16c: Client Message Deduplication Helper (appendMessageDeduped)', () => {
  it('appends a new message to an empty or existing list', () => {
    const msg1 = { id: 1, text: 'Hello', timestamp: '2026-11-25T10:00:00Z' };
    const res1 = appendMessageDeduped([], msg1);
    expect(res1).toHaveLength(1);
    expect(res1[0].id).toBe(1);

    const msg2 = { id: 2, text: 'How are you?', timestamp: '2026-11-25T10:01:00Z' };
    const res2 = appendMessageDeduped(res1, msg2);
    expect(res2).toHaveLength(2);
    expect(res2[1].id).toBe(2);
  });

  it('rejects duplicate message when the id already exists in the list', () => {
    const list = [
      { id: 101, text: 'Agent message from HTTP', timestamp: '2026-11-25T10:00:00Z' },
    ];
    // Exact duplicate from socket event
    const duplicate = { id: 101, text: 'Agent message from Socket', timestamp: '2026-11-25T10:00:00Z' };
    const res = appendMessageDeduped(list, duplicate);
    expect(res).toHaveLength(1);
    expect(res[0].text).toBe('Agent message from HTTP');
  });

  it('handles string vs numeric id comparison correctly', () => {
    const list = [
      { id: 202, text: 'Numeric ID', timestamp: '2026-11-25T10:00:00Z' },
    ];
    // Socket or response payload with string ID
    const duplicateString = { id: '202', text: 'String ID duplicate', timestamp: '2026-11-25T10:00:00Z' };
    const res = appendMessageDeduped(list, duplicateString);
    expect(res).toHaveLength(1);
  });

  it('sorts messages chronologically to handle out-of-order arrival', () => {
    const laterMsg = { id: 10, text: 'Later message', timestamp: '2026-11-25T10:05:00Z' };
    const earlierMsg = { id: 9, text: 'Earlier delayed message', timestamp: '2026-11-25T10:02:00Z' };

    const initial = appendMessageDeduped([], laterMsg);
    expect(initial[0].id).toBe(10);

    // Arrives out of order
    const updated = appendMessageDeduped(initial, earlierMsg);
    expect(updated).toHaveLength(2);
    expect(updated[0].id).toBe(9);
    expect(updated[1].id).toBe(10);
  });

  it('safely handles null, undefined, and messages without id', () => {
    const list = [{ id: 1, text: 'Valid' }];
    expect(appendMessageDeduped(list, null)).toBe(list);
    expect(appendMessageDeduped(list, undefined)).toBe(list);
    expect(appendMessageDeduped(list, {})).toBe(list);
    expect(appendMessageDeduped(null, { id: 2, text: 'New' })).toHaveLength(1);
  });
});
