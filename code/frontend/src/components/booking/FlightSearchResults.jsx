/**
 * FlightSearchResults — renders the list of matching flights with real fares per cabin class.
 * Matches Stitch screen c5c9a568520849df9dfbead3d474cfc6.
 */

function durationLabel(dep, arr) {
  const diff = new Date(arr) - new Date(dep);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function fareCents(flight, seatClass) {
  const map = {
    economy: flight.economy_price_cents,
    premium_economy: flight.premium_economy_price_cents,
    business: flight.business_price_cents,
    first: flight.first_price_cents,
  };
  return map[seatClass] ?? flight.economy_price_cents;
}

export default function FlightSearchResults({ flights, origin, destination, seatClass, onSelectFlight }) {
  if (flights.length === 0) {
    return (
      <div className="ticket-notch-card" style={{ padding: '36px', textAlign: 'center', color: 'var(--color-slate)' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--color-outline-variant)', marginBottom: '8px' }}>
          flight_takeoff
        </span>
        <p style={{ fontWeight: 700, fontSize: '16px', margin: '4px 0' }}>No flights found matching this route.</p>
        <p style={{ fontSize: '13px', margin: 0 }}>Try searching between popular hubs like DEL, BOM, or BLR.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.4rem', margin: 0 }}>
          Available Flights ({flights.length})
        </h2>
        <span style={{ fontSize: '13px', color: 'var(--color-slate)', fontWeight: 600 }}>
          {origin} &rarr; {destination}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {flights.map((f) => {
          const priceCents = fareCents(f, seatClass);
          const priceFormatted = (priceCents / 100).toFixed(0);
          const duration = durationLabel(f.scheduled_departure, f.scheduled_arrival);

          return (
            <div
              key={f.id}
              className="ticket-notch-card"
              style={{ padding: '24px 28px', cursor: 'pointer' }}
              onClick={() => onSelectFlight(f, seatClass)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelectFlight(f, seatClass)}
              aria-label={`Select flight ${f.flight_number} from ${f.origin_code} to ${f.dest_code}`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                {/* Airline + flight */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div className="brand-icon-circle" style={{ width: '44px', height: '44px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>airlines</span>
                  </div>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 800, fontFamily: 'var(--font-display)' }}>
                      {f.flight_number}
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--color-slate)', fontWeight: 600 }}>
                      {f.aircraft_model || 'Airbus A320neo'} &middot; Gate {f.gate_code || 'TBD'}
                    </span>
                  </div>
                </div>

                {/* Route timing */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
                  <div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                      {f.origin_code}
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--color-slate)' }}>
                      {new Date(f.scheduled_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '90px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--color-outline)', fontWeight: 700 }}>{duration}</span>
                    <div style={{ width: '100%', height: '2px', background: 'var(--color-outline-variant)', position: 'relative', margin: '6px 0' }}>
                      <span className="material-symbols-outlined" style={{ position: 'absolute', top: '-9px', left: '40%', fontSize: '18px', color: 'var(--color-primary)' }}>
                        flight
                      </span>
                    </div>
                    <span style={{ fontSize: '10px', color: 'var(--color-success)', fontWeight: 700 }}>Non-Stop</span>
                  </div>

                  <div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-secondary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                      {f.dest_code}
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--color-slate)' }}>
                      {new Date(f.scheduled_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                {/* Fare + CTA */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '11px', color: 'var(--color-outline)', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>From</span>
                    <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-on-surface)', fontFamily: 'var(--font-display)' }}>
                      ₹{priceFormatted}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--color-slate)', display: 'block', textTransform: 'capitalize' }}>
                      {seatClass.replace('_', ' ')}
                    </span>
                  </div>
                  <button className="btn-primary-aero" style={{ padding: '10px 22px' }} type="button">
                    <span>Select Flight</span>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_forward</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

