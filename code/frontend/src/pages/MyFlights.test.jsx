import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext.jsx';
import { SocketProvider } from '../context/SocketContext.jsx';
import MyFlights, {
  isBookingDeparted,
  isConnectionDeparted,
  isCheckInOpen,
} from './MyFlights.jsx';

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

describe('Task 12.1 Part A: MyFlights Render Crash & Awkward Data Regression Tests', () => {
  const baseTime = new Date('2026-11-24T12:00:00.000Z').getTime();

  describe('Departure and Check-In Helper Robustness', () => {
    it('handles null, undefined, or empty bookings safely', () => {
      expect(isBookingDeparted(null, baseTime)).toBe(false);
      expect(isBookingDeparted(undefined, baseTime)).toBe(false);
      expect(isBookingDeparted({}, baseTime)).toBe(false);
      expect(isCheckInOpen(null, baseTime)).toBe(false);
      expect(isCheckInOpen(undefined, baseTime)).toBe(false);
      expect(isCheckInOpen({}, baseTime)).toBe(false);
    });

    it('identifies departed flights correctly by status or scheduled time', () => {
      expect(isBookingDeparted({ flight_status: 'departed' }, baseTime)).toBe(true);
      expect(isBookingDeparted({ flight_status: 'landed' }, baseTime)).toBe(true);
      expect(
        isBookingDeparted(
          { flight_status: 'scheduled', scheduled_departure: '2026-11-24T10:00:00.000Z' },
          baseTime
        )
      ).toBe(true);
      expect(
        isBookingDeparted(
          { flight_status: 'scheduled', scheduled_departure: '2026-11-24T16:00:00.000Z' },
          baseTime
        )
      ).toBe(false);
    });

    it('handles connection departure status and missing leg dates safely', () => {
      expect(isConnectionDeparted(null, baseTime)).toBe(false);
      expect(isConnectionDeparted({}, baseTime)).toBe(false);
      expect(isConnectionDeparted({ outbound_status: 'landed' }, baseTime)).toBe(true);
      expect(
        isConnectionDeparted(
          { outbound_status: 'scheduled', outbound_departure: '2026-11-24T10:00:00.000Z' },
          baseTime
        )
      ).toBe(true);
      expect(
        isConnectionDeparted(
          { outbound_status: 'scheduled', outbound_departure: null },
          baseTime
        )
      ).toBe(false);
    });

    it('calculates check-in availability window safely with invalid date strings', () => {
      expect(
        isCheckInOpen({ status: 'confirmed', scheduled_departure: 'not-a-date' }, baseTime)
      ).toBe(false);
      expect(
        isCheckInOpen(
          { status: 'confirmed', scheduled_departure: '2026-11-24T18:00:00.000Z' },
          baseTime
        )
      ).toBe(true); // 6 hours ahead -> within 24h
      expect(
        isCheckInOpen(
          { status: 'confirmed', scheduled_departure: '2026-11-26T18:00:00.000Z' },
          baseTime
        )
      ).toBe(false); // 54 hours ahead -> outside 24h
    });
  });

  describe('JSX Rendering with Awkward Data', () => {
    it('renders without crashing when booking has no baggage, no assistance, and null boarding_group', () => {
      const awkwardBooking = {
        id: 901,
        booking_ref: 'BK-AWK01',
        status: 'confirmed',
        flight_number: '6E-101',
        origin_code: 'DEL',
        dest_code: 'BOM',
        scheduled_departure: new Date(Date.now() + 4 * 3600_000).toISOString(),
        scheduled_arrival: new Date(Date.now() + 6 * 3600_000).toISOString(),
        price_cents: 450000,
        passenger_name: 'Test Passenger',
        seat_number: '14B',
        seat_class: 'economy',
        flight_status: 'scheduled',
        boarding_group: null, // null boarding group
        assistance_type: null, // no assistance
        assistance_status: null,
      };

      const html = renderWithProviders(
        <MyFlights
          initialBookings={[awkwardBooking]}
          initialConnections={[]}
          initialBaggage={{}}
          initialActiveTab="upcoming"
        />
      );

      expect(html).toContain('BK-AWK01');
      expect(html).toContain('DEL');
      expect(html).toContain('BOM');
      expect(html).toContain('6E-101');
      expect(html).not.toContain('Boarding Group');
      expect(html).not.toContain('Requested Care:');
    });

    it('renders without crashing for a past booking (historical)', () => {
      const pastBooking = {
        id: 902,
        booking_ref: 'BK-PAST01',
        status: 'checked_in',
        flight_number: 'AI-505',
        origin_code: 'BLR',
        dest_code: 'DEL',
        scheduled_departure: new Date(Date.now() - 48 * 3600_000).toISOString(),
        scheduled_arrival: new Date(Date.now() - 45 * 3600_000).toISOString(),
        price_cents: 600000,
        passenger_name: 'Historical Traveler',
        seat_number: '03A',
        seat_class: 'business',
        flight_status: 'landed',
        boarding_group: 1,
      };

      const html = renderWithProviders(
        <MyFlights
          initialBookings={[pastBooking]}
          initialConnections={[]}
          initialBaggage={{}}
          initialActiveTab="past"
        />
      );

      expect(html).toContain('BK-PAST01');
      expect(html).toContain('Travel Completed');
      expect(html).toContain('AI-505');
    });

    it('renders without crashing when connection has a missing leg / missing telemetry', () => {
      const brokenConnection = {
        id: 77,
        status: 'on_track',
        hub_code: 'BOM',
        hub_name: null,
        min_connection_minutes: 60,
        actual_connection_minutes: 90,
        // Segment 1 (inbound) exists
        inbound_booking_id: 801,
        inbound_flight_number: 'UK-101',
        inbound_origin_code: 'DEL',
        inbound_origin_name: null,
        inbound_departure: new Date(Date.now() + 5 * 3600_000).toISOString(),
        inbound_arrival: new Date(Date.now() + 7 * 3600_000).toISOString(),
        inbound_class: null,
        inbound_seat_number: null,
        inbound_delay_minutes: 0,
        // Segment 2 (outbound) has missing details
        outbound_booking_id: null,
        outbound_flight_number: null,
        destination_code: 'GOI',
        destination_name: null,
        outbound_departure: null,
        outbound_arrival: null,
        outbound_status: 'scheduled',
      };

      const html = renderWithProviders(
        <MyFlights
          initialBookings={[]}
          initialConnections={[brokenConnection]}
          initialBaggage={{}}
          initialActiveTab="upcoming"
        />
      );

      expect(html).toContain('Connecting Flight Itineraries');
      expect(html).toContain('BOM');
      expect(html).toContain('UK-101');
    });

    it('renders without crashing when baggage is lost or has incomplete scan history', () => {
      const bookingWithLostBag = {
        id: 903,
        booking_ref: 'BK-BAG01',
        status: 'checked_in',
        flight_number: '6E-303',
        origin_code: 'DEL',
        dest_code: 'MAA',
        scheduled_departure: new Date(Date.now() + 8 * 3600_000).toISOString(),
        scheduled_arrival: new Date(Date.now() + 10 * 3600_000).toISOString(),
        price_cents: 350000,
        passenger_name: 'Luggage Passenger',
        seat_number: '20C',
        seat_class: 'economy',
        flight_status: 'scheduled',
        boarding_group: 2,
      };

      const lostBags = [
        {
          id: 501,
          tag_number: 'BG-999-LOST',
          weight: null, // null weight
          status: 'lost',
          scans: [], // empty scans
        },
        {
          id: 502,
          tag_number: 'BG-999-SCAN',
          weight: '18.50',
          status: 'in_transit',
          scans: [
            { id: 1, status: 'checked_in', location: null, scanned_at: new Date().toISOString() },
            { id: 2, status: 'loaded', location: 'Gate 4', scanned_at: new Date().toISOString() },
          ],
        },
      ];

      const html = renderWithProviders(
        <MyFlights
          initialBookings={[bookingWithLostBag]}
          initialConnections={[]}
          initialBaggage={{ [bookingWithLostBag.id]: lostBags }}
          initialActiveTab="upcoming"
        />
      );

      expect(html).toContain('BG-999-LOST');
      expect(html).toContain('Baggage irregularity reported');
      expect(html).toContain('BG-999-SCAN');
      expect(html).toContain('18.50');
      expect(html).toContain('kg');
    });
  });
});
