/**
 * FlightSearchFilters — search bar matching the Stitch "Flight Booking & Dispatch" header panel.
 * Handles origin/destination searchable comboboxes, DatePicker, class selector, and swap button.
 */
import AirportSelect from '../common/AirportSelect.jsx';
import DatePicker from '../common/DatePicker.jsx';

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

  const isSameAirport = Boolean(
    origin && destination && origin.trim().toUpperCase() === destination.trim().toUpperCase()
  );

  function handleFormSubmit(e) {
    e.preventDefault();
    if (isSameAirport) return;
    if (onSubmit) onSubmit(e);
  }

  return (
    <div className="flight-search-bar" style={{ marginBottom: '24px' }}>
      <form
        onSubmit={handleFormSubmit}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 44px 1fr 1fr 1fr 180px',
          gap: '12px',
          alignItems: 'center',
        }}
      >
        {/* Origin Airport */}
        <div className="search-field-module">
          <span className="field-sublabel">
            <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-primary)' }}>
              flight_takeoff
            </span>
            From Airport
          </span>
          <AirportSelect
            value={origin}
            onChange={(code) => onOriginChange(code)}
            placeholder="Select origin"
          />
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

        {/* Destination Airport */}
        <div className="search-field-module">
          <span className="field-sublabel">
            <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-secondary)' }}>
              flight_land
            </span>
            To Airport
          </span>
          <AirportSelect
            value={destination}
            onChange={(code) => onDestinationChange(code)}
            placeholder="Select destination"
          />
        </div>

        {/* Departure Date */}
        <div className="search-field-module">
          <span className="field-sublabel">
            <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-primary)' }}>
              calendar_month
            </span>
            Departure Date
          </span>
          <DatePicker
            value={date}
            onChange={(val) => onDateChange(val)}
            minDate="today"
            placeholder="Select date"
            clearable
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

        {/* Submit Button */}
        <button
          type="submit"
          className="btn-primary-aero"
          style={{ height: '54px' }}
          disabled={loading || isSameAirport}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>search</span>
          <span>{loading ? 'Searching…' : 'Find Flights'}</span>
        </button>
      </form>

      {/* Inline validation when origin and destination are identical */}
      {isSameAirport && (
        <div
          role="alert"
          style={{
            marginTop: '10px',
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-error-container)',
            color: 'var(--color-on-error-container)',
            fontSize: '12.5px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
            error
          </span>
          <span>From and To airports cannot be the same. Please choose different airports.</span>
        </div>
      )}
    </div>
  );
}
