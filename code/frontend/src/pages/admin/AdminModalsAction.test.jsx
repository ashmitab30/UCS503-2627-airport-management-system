// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mocks
vi.mock('../../api/client.js', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../context/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { id: 162, name: 'Admin Lead', role: 'admin', email: 'admin@meridianops.com' },
    token: 'mock-admin-token',
  }),
}));

vi.mock('../../context/SocketContext.jsx', () => ({
  useSocket: () => ({
    socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    status: 'connected',
    connected: true,
  }),
  LiveStatusPill: () => <span data-testid="live-status-pill">LIVE</span>,
}));

import { apiFetch } from '../../api/client.js';
import SecurityConsole from '../security/SecurityConsole.jsx';
import AdminFacilities from './AdminFacilities.jsx';
import StaffBaggage from '../staff/StaffBaggage.jsx';

describe('Task 16c Part B: Admin Pages Dialogs & Action Buttons (RTL + jsdom)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('1. Security Console Modals (Add Checkpoint & Change Status)', () => {
    it('opens and closes Add Checkpoint dialog upon clicking the button', async () => {
      // Mock checkpoints response
      apiFetch.mockResolvedValueOnce({
        checkpoints: [
          {
            id: 101,
            airport_id: 1,
            airport_code: 'DEL',
            airport_name: 'Indira Gandhi',
            name: 'Gate 4 Screening',
            location: 'Terminal 3',
            status: 'open',
            stats: { screened_last_hour: 45, flagged_last_hour: 1, secondary_screenings: 0 },
          },
        ],
      });
      // Mock incidents summary & logs
      apiFetch.mockResolvedValue({ incidents: [], logs: [], accessLogs: [] });

      render(
        <MemoryRouter>
          <SecurityConsole />
        </MemoryRouter>
      );

      // Verify page loaded
      await waitFor(() => {
        expect(screen.getByText('Security Operations Console')).toBeDefined();
      });

      // Find "Add Checkpoint" button
      const addBtn = screen.getByRole('button', { name: /add checkpoint/i });
      expect(addBtn).toBeDefined();

      // Click "Add Checkpoint"
      fireEvent.click(addBtn);

      // Verify dialog appears in the document
      expect(screen.getByText('Add Security Checkpoint Lane')).toBeDefined();
      expect(screen.getByText(/Checkpoint Name/i)).toBeDefined();

      // Click Cancel on dialog (inside the modal overlay)
      const cancelBtns = screen.getAllByRole('button', { name: /cancel/i });
      fireEvent.click(cancelBtns[cancelBtns.length - 1]);

      // Verify dialog is closed
      expect(screen.queryByText('Add Security Checkpoint Lane')).toBeNull();
    });

    it('opens and closes Change Status dialog upon clicking Change Status button', async () => {
      apiFetch.mockResolvedValueOnce({
        checkpoints: [
          {
            id: 202,
            airport_id: 1,
            airport_code: 'DEL',
            airport_name: 'Indira Gandhi',
            name: 'Terminal 1 Lane A',
            location: 'T1 Gate 2',
            status: 'open',
            stats: { screened_last_hour: 10, flagged_last_hour: 0, secondary_screenings: 0 },
          },
        ],
      });
      apiFetch.mockResolvedValue({ incidents: [], logs: [], accessLogs: [] });

      render(
        <MemoryRouter>
          <SecurityConsole />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Terminal 1 Lane A')).toBeDefined();
      });

      const changeStatusBtns = screen.getAllByRole('button', { name: /change status/i });
      fireEvent.click(changeStatusBtns[0]);

      // Dialog opens
      expect(screen.getByText('Update Checkpoint Status')).toBeDefined();

      // Cancel closes
      const cancelBtns = screen.getAllByRole('button', { name: /cancel/i });
      fireEvent.click(cancelBtns[cancelBtns.length - 1]);
      expect(screen.queryByText('Update Checkpoint Status')).toBeNull();
    });
  });

  describe('2. Facilities Directory Modal (Add Facility)', () => {
    it('opens and closes Add Facility modal upon clicking the button', async () => {
      // Mock airports
      apiFetch.mockResolvedValueOnce({
        airports: [{ id: 1, code: 'DEL', name: 'Indira Gandhi' }],
      });
      // Mock facilities
      apiFetch.mockResolvedValueOnce({
        facilities: [
          {
            id: 1,
            airport_id: 1,
            airport_code: 'DEL',
            airport_name: 'Delhi Airport',
            name: 'Plaza Premium Lounge',
            type: 'lounge',
            location_terminal: 'Terminal 3',
            location_gate_proximity: 'Near Gate 25',
            status: 'open',
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
      });

      render(
        <MemoryRouter>
          <AdminFacilities />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Airport Facilities Directory')).toBeDefined();
      });

      const addFacilityBtn = screen.getByRole('button', { name: /add facility/i });
      expect(addFacilityBtn).toBeDefined();

      // Click Add Facility
      fireEvent.click(addFacilityBtn);

      // Dialog appears with modal-backdrop class
      expect(screen.getByText('Add New Airport Facility')).toBeDefined();
      const backdrop = document.querySelector('.modal-backdrop');
      expect(backdrop).not.toBeNull();

      // Close via Cancel button in modal
      const cancelBtns = screen.getAllByRole('button', { name: /cancel/i });
      fireEvent.click(cancelBtns[cancelBtns.length - 1]);

      expect(screen.queryByText('Add New Airport Facility')).toBeNull();
    });
  });

  describe('3. Baggage Management Modal (Register Bag)', () => {
    it('opens and closes Register Bag modal upon clicking the button', async () => {
      // Mock baggage list
      apiFetch.mockResolvedValueOnce({
        items: [
          {
            id: 1,
            tag_number: '1000000001',
            booking_id: 5,
            booking_ref: 'BK-1001',
            passenger_name: 'Priya Sharma',
            passenger_email: 'priya@test.com',
            flight_number: 'AI-101',
            weight: '18.5',
            status: 'checked_in',
            last_scanned_location: 'Check-in Belt 4',
            last_scanned_at: new Date().toISOString(),
          },
        ],
        total: 1,
      });

      render(
        <MemoryRouter>
          <StaffBaggage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/Baggage Tracking/i)).toBeDefined();
      });

      const registerBtn = screen.getByRole('button', { name: /register bag/i });
      expect(registerBtn).toBeDefined();

      // Click Register Bag
      fireEvent.click(registerBtn);

      // Dialog appears with modal-backdrop and title
      expect(screen.getByText('Register Checked Baggage')).toBeDefined();
      const backdrop = document.querySelector('.modal-backdrop');
      expect(backdrop).not.toBeNull();

      // Close via Cancel button in dialog (or close 'X' button)
      const closeBtn = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeBtn);

      expect(screen.queryByText('Register Checked Baggage')).toBeNull();
    });
  });
});
