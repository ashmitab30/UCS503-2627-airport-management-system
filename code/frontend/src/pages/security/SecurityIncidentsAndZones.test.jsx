import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext.jsx';
import { SocketProvider } from '../../context/SocketContext.jsx';
import SecurityConsole, {
  getSeverityBadgeMeta,
  getIncidentStatusMeta,
  canAdvanceStatus,
  validateIncidentFormInput,
  validateZoneAccessFormInput,
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

describe('Task 15: Security Incidents and Restricted Zones Frontend Unit Tests', () => {
  describe('Severity and Status Meta Helpers', () => {
    it('returns appropriate styling and labels for all severity levels', () => {
      const crit = getSeverityBadgeMeta('critical');
      expect(crit.label).toBe('CRITICAL');
      expect(crit.pillClass).toBe('status-pill-red');

      const high = getSeverityBadgeMeta('high');
      expect(high.label).toBe('HIGH');
      expect(high.pillClass).toBe('status-pill-amber');

      const med = getSeverityBadgeMeta('medium');
      expect(med.label).toBe('MEDIUM');

      const low = getSeverityBadgeMeta('low');
      expect(low.label).toBe('LOW');
      expect(low.pillClass).toBe('status-pill-blue');
    });

    it('returns appropriate styling and labels for incident statuses', () => {
      const open = getIncidentStatusMeta('open');
      expect(open.label).toBe('OPEN');
      expect(open.pillClass).toBe('status-pill-red');

      const inv = getIncidentStatusMeta('investigating');
      expect(inv.label).toBe('INVESTIGATING');
      expect(inv.pillClass).toBe('status-pill-amber');

      const closed = getIncidentStatusMeta('closed');
      expect(closed.label).toBe('CLOSED');
      expect(closed.pillClass).toBe('status-pill-green');
    });
  });

  describe('Incident Status Progression Rules (canAdvanceStatus)', () => {
    it('allows open -> investigating transition', () => {
      expect(canAdvanceStatus('open', 'investigating')).toBe(true);
    });

    it('allows investigating -> closed transition', () => {
      expect(canAdvanceStatus('investigating', 'closed')).toBe(true);
    });

    it('rejects jumping straight from open -> closed', () => {
      expect(canAdvanceStatus('open', 'closed')).toBe(false);
    });

    it('rejects backward transitions from investigating -> open', () => {
      expect(canAdvanceStatus('investigating', 'open')).toBe(false);
    });

    it('rejects transitions once an incident is closed', () => {
      expect(canAdvanceStatus('closed', 'investigating')).toBe(false);
      expect(canAdvanceStatus('closed', 'open')).toBe(false);
    });
  });

  describe('validateIncidentFormInput Helper', () => {
    it('rejects missing or empty location', () => {
      const res = validateIncidentFormInput({
        location: '   ',
        type: 'unattended_baggage',
        severity: 'high',
        description: 'Black bag',
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/location is strictly required/i);
    });

    it('rejects missing type or severity', () => {
      const noType = validateIncidentFormInput({
        location: 'Gate 4',
        type: '',
        severity: 'high',
      });
      expect(noType.valid).toBe(false);

      const noSev = validateIncidentFormInput({
        location: 'Gate 4',
        type: 'other',
        severity: '',
      });
      expect(noSev.valid).toBe(false);
    });

    it('rejects descriptions exceeding 1000 characters', () => {
      const longDesc = 'x'.repeat(1001);
      const res = validateIncidentFormInput({
        location: 'Gate 4',
        type: 'other',
        severity: 'low',
        description: longDesc,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/must not exceed 1000 characters/i);
    });

    it('accepts valid incident payload', () => {
      const res = validateIncidentFormInput({
        location: 'Terminal 3 Pier B',
        type: 'suspicious_behavior',
        severity: 'medium',
        description: 'Passenger questioning access doors',
      });
      expect(res.valid).toBe(true);
      expect(res.error).toBeNull();
    });
  });

  describe('validateZoneAccessFormInput Helper', () => {
    it('rejects missing restricted zone', () => {
      const res = validateZoneAccessFormInput({
        zone: '',
        employee: 'staff@meridian.com',
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/select a restricted zone/i);
    });

    it('rejects missing employee identification', () => {
      const res = validateZoneAccessFormInput({
        zone: 'AIRSIDE_APRON',
        employee: '   ',
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/provide employee ID or email/i);
    });

    it('accepts valid zone and employee input', () => {
      const res = validateZoneAccessFormInput({
        zone: 'AIRSIDE_APRON',
        employee: 'staff@meridian.com',
      });
      expect(res.valid).toBe(true);
      expect(res.error).toBeNull();
    });
  });

  describe('SecurityConsole Tabs & Header Rendering', () => {
    it('renders console header, all three security tabs, and incident summary counters', () => {
      const html = renderWithProviders(<SecurityConsole />);
      expect(html).toContain('Security Operations Console');
      expect(html).toContain('Active Security Incidents:');
      expect(html).toContain('Checkpoints &amp; Screening');
      expect(html).toContain('Incidents &amp; Alerts');
      expect(html).toContain('Restricted Zones');
    });
  });
});
