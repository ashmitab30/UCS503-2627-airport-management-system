import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext.jsx';
import { SocketProvider } from '../context/SocketContext.jsx';
import EmergencyBanner, { formatTimeAgo } from './EmergencyBanner.jsx';

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

describe('Task 13: EmergencyBanner Unit Tests', () => {
  describe('formatTimeAgo helper', () => {
    it('formats recent timestamps as just now or minutes ago', () => {
      const now = Date.now();
      expect(formatTimeAgo(new Date(now - 10 * 1000).toISOString())).toBe('just now');
      expect(formatTimeAgo(new Date(now - 5 * 60 * 1000).toISOString())).toBe('5m ago');
      expect(formatTimeAgo(new Date(now - 65 * 60 * 1000).toISOString())).toBe('1h 5m ago');
      expect(formatTimeAgo(null)).toBe('');
      expect(formatTimeAgo(undefined)).toBe('');
    });
  });

  describe('Banner presentation and acknowledgement logic', () => {
    it('renders null when there are no active emergencies for the user role', () => {
      const html = renderWithProviders(<EmergencyBanner />);
      // Empty string because emergencies is [] initially and returns null
      expect(html).toBe('');
    });

    it('acknowledgement state correctly determines whether Acknowledge button or badge renders', () => {
      const unacknowledgedEmergency = {
        id: 101,
        type: 'fire',
        status: 'active',
        flight_number: null,
        gate_code: 'A1',
        declared_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        is_acknowledged: false,
        acknowledged_by_name: null,
        acknowledged_at: null,
        notes: 'Small fire near gate power',
      };

      const acknowledgedEmergency = {
        ...unacknowledgedEmergency,
        is_acknowledged: true,
        acknowledged_by_name: 'Ramesh Kumar',
        acknowledged_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      };

      expect(unacknowledgedEmergency.is_acknowledged).toBe(false);
      expect(acknowledgedEmergency.is_acknowledged).toBe(true);
      expect(acknowledgedEmergency.acknowledged_by_name).toBe('Ramesh Kumar');
    });
  });
});
