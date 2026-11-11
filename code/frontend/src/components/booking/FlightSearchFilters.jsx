/**
 * FlightSearchFilters — search bar matching the Stitch "Flight Booking & Dispatch" header panel.
 * Handles origin/destination IATA inputs, date picker, class selector, and swap button.
 */
export default function FlightSearchFilters({
  origin,
  destination,
  date,
  seatClass,
  loading,
  onOriginChange,
  onDestinationChange,
  onDateChange,
  onClassChange,
  onSwap,
  onSubmit,
}) {
  const CLASS_OPTIONS = [
    { value: 'economy', label: 'Economy' },
    { value: 'premium_economy', label: 'Premium Economy' },
    { value: 'business', label: 'Business' },
    { value: 'first', label: 'First Class' },
  ];

  return (
    <div className="flight-search-bar" style={{ marginBottom: '24px' }}>
      <form
        onSubmit={onSubmit}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 44px 1fr 1fr 1fr 180px',
          gap: '12px',
          alignItems: 'center',
        }}
      >
        {/* Origin */}
        <div className="search-field-module">
          <span className="field-sublabel">
            <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-primary)' }}>
              flight_takeoff
            </span>
            From Airport
          </span>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className="iata-tag-bold">{origin}</span>
            <input
              className="field-input-naked"
              value={origin}
              onChange={(e) => onOriginChange(e.target.value.toUpperCase())}
              placeholder="DEL"
              maxLength={4}
              aria-label="Origin airport IATA code"
            />
          </div>
        </div>

        {/* Swap */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={onSwap}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: 'var(--color-surface-high)',
              color: 'var(--color-primary)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Swap origin and destination"
            aria-label="Swap origin and destination"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>swap_horiz</span>
          </button>
        </div>

        {/* Destination */}
        <div className="search-field-module">
          <span className="field-sublabel">
            <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-secondary)' }}>
              flight_land
            </span>
            To Airport
          </span>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className="iata-tag-bold" style={{ color: 'var(--color-secondary)' }}>{destination}</span>
            <input
              className="field-input-naked"
              value={destination}
              onChange={(e) => onDestinationChange(e.target.value.toUpperCase())}
              placeholder="BOM"
              maxLength={4}
              aria-label="Destination airport IATA code"
            />
          </div>
        </div>

        {/* Date */}
        <div className="search-field-module">
          <span className="field-sublabel">
            <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-primary)' }}>
              calendar_month
            </span>
            Departure Date
          </span>
          <input
            type="date"
            className="field-input-naked"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            aria-label="Departure date"
          />
        </div>

        {/* Cabin Class */}
        <div className="search-field-module">
          <span className="field-sublabel">
            <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-primary)' }}>
              airline_seat_recline_extra
            </span>
            Cabin Class
          </span>
          <select
            className="field-input-naked"
            value={seatClass}
            onChange={(e) => onClassChange(e.target.value)}
            aria-label="Cabin class"
            style={{ cursor: 'pointer' }}
          >
            {CLASS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Submit */}
        <button type="submit" className="btn-primary-aero" style={{ height: '54px' }} disabled={loading}>
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>search</span>
          <span>{loading ? 'Searching…' : 'Find Flights'}</span>
        </button>
      </form>
    </div>
  );
}

