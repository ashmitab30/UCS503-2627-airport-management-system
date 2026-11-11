/**
 * SeatDeckMap — interactive aircraft cabin seat picker.
 * Derives rows and columns from the actual seat data returned by the API.
 * Matches Stitch screen 43f3c451383540d481c4f25bf8ae6b61.
 *
 * Seat state colours:
 *   Available  — white with border
 *   Held       — amber (is_booked=false but held_until in future is handled server-side;
 *                any seat with is_available=false that isn't the selected seat is shown as booked)
 *   Booked     — muted grey, disabled
 *   Selected   — royal-blue, check mark
 */

function groupByClass(seats) {
  const order = ['first', 'business', 'premium_economy', 'economy'];
  const groups = {};
  for (const s of seats) {
    if (!groups[s.class]) groups[s.class] = [];
    groups[s.class].push(s);
  }
  return order.filter((c) => groups[c]).map((c) => ({ label: c, seats: groups[c] }));
}

function parseSeatNumber(seatNum) {
  const match = seatNum.match(/^(\d+)([A-Z]+)$/);
  if (!match) return { row: 0, col: '' };
  return { row: parseInt(match[1], 10), col: match[2] };
}

function buildRowMap(seats) {
  // Returns { rowNum -> { colLetter -> seatObj } }
  const rows = {};
  for (const s of seats) {
    const { row, col } = parseSeatNumber(s.seat_number);
    if (!rows[row]) rows[row] = {};
    rows[row][col] = s;
  }
  return rows;
}

function getAllCols(rowMap) {
  const colSet = new Set();
  for (const cols of Object.values(rowMap)) {
    for (const col of Object.keys(cols)) colSet.add(col);
  }
  return [...colSet].sort();
}

const CLASS_LABELS = {
  first: 'First Class',
  business: 'Business',
  premium_economy: 'Premium Economy',
  economy: 'Economy',
};

const CLASS_ACCENT = {
  first: 'var(--color-warning)',
  business: 'var(--color-secondary)',
  premium_economy: '#a78bfa',
  economy: 'var(--color-outline)',
};

export default function SeatDeckMap({ seats, selectedSeat, onSelectSeat }) {
  const groups = groupByClass(seats);

  if (seats.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-slate)' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '40px' }}>event_seat</span>
        <p>Loading seat map…</p>
      </div>
    );
  }

  return (
    <div className="cockpit-fuselage-wrap">
      {/* Nose Radome */}
      <div className="cockpit-nose-radome">
        <span className="avionics-beacon" />
        <div className="cockpit-windshield-group">
          <div className="cockpit-window-pane" />
          <div className="cockpit-window-pane" />
          <div className="cockpit-window-pane" />
        </div>
      </div>

      <div style={{ textAlign: 'center', margin: '14px 0 18px' }}>
        <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', letterSpacing: '0.06em' }}>
          Flight Deck &middot; Cabin View
        </span>
        <h3 style={{ fontSize: '18px', fontWeight: 800, margin: '2px 0 0', fontFamily: 'var(--font-display)' }}>
          Interactive Seat Map
        </h3>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', padding: '8px 16px', background: 'var(--color-surface-lowest)', borderRadius: '999px', margin: '0 auto 20px', width: 'fit-content', boxShadow: '0 1px 4px rgba(6, 27, 58, 0.05)' }}>
        {[
          { color: '#fff', border: '1px solid #c2c6d8', label: 'Available' },
          { color: 'var(--color-surface-high)', border: 'none', label: 'Booked' },
          { color: 'var(--color-primary)', border: 'none', label: 'Selected' },
        ].map(({ color, border, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: color, border }} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Cabin sections */}
      {groups.map(({ label, seats: groupSeats }) => {
        const rowMap = buildRowMap(groupSeats);
        const sortedRows = Object.keys(rowMap).map(Number).sort((a, b) => a - b);
        const cols = getAllCols(rowMap);
        const midpoint = Math.floor(cols.length / 2);
        const leftCols = cols.slice(0, midpoint);
        const rightCols = cols.slice(midpoint);

        return (
          <div key={label} style={{ marginBottom: '24px' }}>
            {/* Class header band */}
            <div style={{
              textAlign: 'center',
              padding: '4px 16px',
              margin: '0 auto 12px',
              width: 'fit-content',
              background: CLASS_ACCENT[label] + '22',
              border: `1px solid ${CLASS_ACCENT[label]}44`,
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 800,
              textTransform: 'uppercase',
              color: CLASS_ACCENT[label],
              letterSpacing: '0.06em',
            }}>
              {CLASS_LABELS[label]}
            </div>

            {/* Column headers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: `${leftCols.map(() => '36px').join(' ')} 24px ${rightCols.map(() => '36px').join(' ')}`,
              gap: '5px',
              justifyContent: 'center',
              marginBottom: '6px',
              textAlign: 'center',
              fontWeight: 800,
              fontSize: '11px',
              color: 'var(--color-outline)',
            }}>
              {leftCols.map((c) => <span key={c}>{c}</span>)}
              <span style={{ fontSize: '9px', textTransform: 'uppercase' }}>Aisle</span>
              {rightCols.map((c) => <span key={c}>{c}</span>)}
            </div>

            {/* Seat rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
              {sortedRows.map((row) => (
                <div
                  key={row}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `${leftCols.map(() => '36px').join(' ')} 24px ${rightCols.map(() => '36px').join(' ')}`,
                    gap: '5px',
                    alignItems: 'center',
                    textAlign: 'center',
                  }}
                >
                  {leftCols.map((col) => {
                    const seatObj = rowMap[row]?.[col];
                    return <SeatButton key={col} seatObj={seatObj} selectedSeat={selectedSeat} onSelectSeat={onSelectSeat} />;
                  })}
                  <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-outline)' }}>
                    {String(row).padStart(2, '0')}
                  </span>
                  {rightCols.map((col) => {
                    const seatObj = rowMap[row]?.[col];
                    return <SeatButton key={col} seatObj={seatObj} selectedSeat={selectedSeat} onSelectSeat={onSelectSeat} />;
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div style={{ marginTop: '12px', textAlign: 'center' }}>
        <span style={{ fontSize: '12px', color: 'var(--color-outline)' }}>
          {seats.filter((s) => s.is_available).length} seats available
        </span>
      </div>
    </div>
  );
}

function SeatButton({ seatObj, selectedSeat, onSelectSeat }) {
  if (!seatObj) {
    // Placeholder for irregular seat layout
    return <div style={{ width: '36px', height: '32px' }} />;
  }

  const isAvail = seatObj.is_available;
  const isSelected = selectedSeat?.id === seatObj.id;

  return (
    <button
      type="button"
      disabled={!isAvail}
      onClick={() => isAvail && onSelectSeat(seatObj)}
      className={`seat-btn${isSelected ? ' active-seat' : ''}${!isAvail ? ' occupied-seat' : ''}`}
      title={`${seatObj.seat_number} ${isAvail ? `Available — ₹${(seatObj.price_cents / 100).toFixed(0)}` : '(Occupied)'}`}
      aria-label={`Seat ${seatObj.seat_number} ${isAvail ? 'available' : 'occupied'}`}
      aria-pressed={isSelected}
    >
      {isSelected ? '✓' : !isAvail ? '×' : seatObj.seat_number.replace(/^0+/, '')}
    </button>
  );
}
