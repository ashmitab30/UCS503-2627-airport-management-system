// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/client.js', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'Test Passenger', role: 'passenger', email: 'passenger@meridian.com' },
    token: 'mock-passenger-token',
  }),
}));

vi.mock('../context/SocketContext.jsx', () => ({
  useSocket: () => ({
    socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    status: 'connected',
    connected: true,
  }),
  LiveStatusPill: () => <span data-testid="live-status-pill">LIVE</span>,
}));

import { apiFetch } from '../api/client.js';
import BookFlight from './BookFlight.jsx';
import MyFlights from './MyFlights.jsx';

describe('Booking conflict error banners in BookFlight and MyFlights', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('BookFlight shows readable error banner with conflicting flight number on 409 DUPLICATE_BOOKING or TIME_CONFLICT', async () => {
    const futureDep = new Date(Date.now() + 48 * 3600_000).toISOString();
    const futureArr = new Date(Date.now() + 50 * 3600_000).toISOString();

    const conflictErr = new Error('This flight overlaps with your existing booking on flight AI-101.');
    conflictErr.status = 409;
    conflictErr.detail = {
      error: 'This flight overlaps with your existing booking on flight AI-101.',
      code: 'TIME_CONFLICT',
      conflicting_flight_number: 'AI-101',
    };

    apiFetch.mockImplementation((path) => {
      if (path.startsWith('/airports')) {
        return Promise.resolve({ airports: [] });
      }
      if (path.startsWith('/bookings/search-flights')) {
        return Promise.resolve({
          flights: [
            {
              id: 10,
              flight_number: '6E-202',
              origin_code: 'DEL',
              dest_code: 'BOM',
              scheduled_departure: futureDep,
              scheduled_arrival: futureArr,
              status: 'scheduled',
              has_departed: false,
              economy_price_cents: 500000,
              fare_cents: 500000,
            },
          ],
        });
      }
      if (path === '/bookings/flights/10/seats') {
        return Promise.resolve({
          seats: [
            { id: 101, seat_number: '1A', class: 'economy', is_available: true, price_cents: 500000 },
          ],
        });
      }
      if (path === '/bookings/hold') {
        return Promise.reject(conflictErr);
      }
      return Promise.resolve({});
    });

    render(
      <MemoryRouter initialEntries={['/book?origin=DEL&dest=BOM']}>
        <BookFlight />
      </MemoryRouter>
    );

    // Select flight
    const selectBtn = await screen.findByRole('button', { name: /select flight 6e-202/i });
    fireEvent.click(selectBtn);

    // Click Hold Seat & Continue
    const holdBtn = await screen.findByRole('button', { name: /hold seat & continue/i });
    fireEvent.click(holdBtn);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('AI-101');
    expect(alert.textContent).toContain('overlaps');
  });

  it('MyFlights shows readable error banner with conflicting flight number when confirm-payment returns 409', async () => {
    const futureDep = new Date(Date.now() + 48 * 3600_000).toISOString();
    const futureArr = new Date(Date.now() + 50 * 3600_000).toISOString();

    const conflictErr = new Error('You already have an active booking.');
    conflictErr.status = 409;
    conflictErr.detail = {
      error: 'You already have an active booking.',
      code: 'DUPLICATE_BOOKING',
      conflicting_flight_number: '6E-822',
    };

    apiFetch.mockImplementation((path) => {
      if (path === '/bookings/mine') {
        return Promise.resolve({
          bookings: [
            {
              id: 55,
              booking_ref: 'BKHOLD1',
              status: 'held',
              held_until: new Date(Date.now() + 600_000).toISOString(),
              flight_number: '6E-822',
              origin_code: 'BOM',
              dest_code: 'CCU',
              scheduled_departure: futureDep,
              scheduled_arrival: futureArr,
              price_cents: 450000,
              passenger_name: 'Test Passenger',
              seat_number: '12A',
              seat_class: 'economy',
              flight_status: 'scheduled',
            },
          ],
        });
      }
      if (path === '/connections/mine') return Promise.resolve({ connections: [] });
      if (path === '/airports') return Promise.resolve({ airports: [] });
      if (path === '/bookings/55/confirm-payment') return Promise.reject(conflictErr);
      return Promise.resolve({});
    });

    render(
      <MemoryRouter>
        <MyFlights />
      </MemoryRouter>
    );

    const confirmBtn = await screen.findByRole('button', { name: /pay & confirm/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('6E-822');
      expect(alert.textContent).toContain('already have an active booking');
    });
  });
});
