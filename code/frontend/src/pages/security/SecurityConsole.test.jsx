import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext.jsx';
import { SocketProvider } from '../../context/SocketContext.jsx';
import SecurityConsole, {
  getCheckpointStatusMeta,
  validateScreeningFormInput,
} from './SecurityConsole.jsx';

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

function renderWithProviders(ui) {
  return renderToString(
    <AuthProvider>
      <SocketProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </SocketProvider>
    </AuthProvider>
  );
}

describe('Task 14: SecurityConsole Frontend Unit Tests', () => {
  describe('Checkpoint Status Meta Helper', () => {
    it('returns green pill and indicator for open checkpoints', () => {
      const meta = getCheckpointStatusMeta('open');
      expect(meta.pillClass).toBe('status-pill-green');
      expect(meta.dotColor).toBe('green');
      expect(meta.label).toBe('OPEN');
    });

    it('returns amber pill and indicator for delayed checkpoints', () => {
      const meta = getCheckpointStatusMeta('delayed');
      expect(meta.pillClass).toBe('status-pill-amber');
      expect(meta.dotColor).toBe('amber');
      expect(meta.label).toBe('DELAYED');
    });

    it('returns red pill and indicator for closed checkpoints', () => {
      const meta = getCheckpointStatusMeta('closed');
      expect(meta.pillClass).toBe('status-pill-red');
      expect(meta.dotColor).toBe('red');
      expect(meta.label).toBe('CLOSED');
    });
  });

  describe('validateScreeningFormInput Helper', () => {
    it('rejects form when checkpoint is not selected', () => {
      const res = validateScreeningFormInput({
        checkpointId: '',
        bookingRef: 'BK-1001',
        result: 'cleared',
        notes: '',
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/select a checkpoint/i);
    });

    it('rejects form when booking reference is empty', () => {
      const res = validateScreeningFormInput({
        checkpointId: 1,
        bookingRef: '   ',
        result: 'cleared',
        notes: '',
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/enter a booking reference/i);
    });

    it('allows cleared screening with empty notes', () => {
      const res = validateScreeningFormInput({
        checkpointId: 1,
        bookingRef: 'BK-1001',
        result: 'cleared',
        notes: '',
      });
      expect(res.valid).toBe(true);
      expect(res.error).toBeNull();
    });

    it('allows cleared screening with notes provided', () => {
      const res = validateScreeningFormInput({
        checkpointId: 1,
        bookingRef: 'BK-1001',
        result: 'cleared',
        notes: 'Routine bag check completed smoothly',
      });
      expect(res.valid).toBe(true);
      expect(res.error).toBeNull();
    });

    it('strictly requires notes when result is flagged', () => {
      const withoutNotes = validateScreeningFormInput({
        checkpointId: 1,
        bookingRef: 'BK-1002',
        result: 'flagged',
        notes: '',
      });
      expect(withoutNotes.valid).toBe(false);
      expect(withoutNotes.error).toMatch(/notes are strictly required/i);

      const withNotes = validateScreeningFormInput({
        checkpointId: 1,
        bookingRef: 'BK-1002',
        result: 'flagged',
        notes: 'Oversized aerosol bottle detected in carry-on',
      });
      expect(withNotes.valid).toBe(true);
      expect(withNotes.error).toBeNull();
    });

    it('strictly requires notes when result is secondary_screening', () => {
      const withoutNotes = validateScreeningFormInput({
        checkpointId: 1,
        bookingRef: 'BK-1003',
        result: 'secondary_screening',
        notes: '   ',
      });
      expect(withoutNotes.valid).toBe(false);
      expect(withoutNotes.error).toMatch(/notes are strictly required/i);

      const withNotes = validateScreeningFormInput({
        checkpointId: 1,
        bookingRef: 'BK-1003',
        result: 'secondary_screening',
        notes: 'Random swab explosive trace check performed',
      });
      expect(withNotes.valid).toBe(true);
      expect(withNotes.error).toBeNull();
    });
  });

  describe('SecurityConsole Component Render', () => {
    it('renders console header, tabs, and layout sections without crashing', () => {
      const html = renderWithProviders(<SecurityConsole />);
      expect(html).toContain('Security Operations Console');
      expect(html).toContain('Checkpoints &amp; Screening');
      expect(html).toContain('Record Screening');
      expect(html).toContain('Recent Security Screening Logs');
    });
  });
});
