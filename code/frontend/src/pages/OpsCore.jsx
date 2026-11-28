import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { styles } from '../styles.js';
import { formatINR, formatDate, formatTime, formatDateTime } from '../utils/format.js';
import AirportSelect from '../components/common/AirportSelect.jsx';
import DateTimePicker from '../components/common/DateTimePicker.jsx';
import {
  validateResourceAssignmentForm,
  validateAddResourceForm,
  ALLOWED_RESOURCE_TYPES,
  formatResourceOption,
  isFlightAssignable,
  formatFlightOption,
} from '../utils/resourceValidation.js';

const SIZE_CLASSES = ['small', 'medium', 'large', 'jumbo'];

// ---------------------------------------------------------------------
// Top-level Ops Core panel — admin + ops_manager. Mounted from
// Dashboard.jsx alongside the Week 2 staff/shift sections.
// ---------------------------------------------------------------------
export default function OpsCore({ token, isAdmin }) {
  const [airports, setAirports] = useState([]);
  const [aircraftTypes, setAircraftTypes] = useState([]);
  const [gates, setGates] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    apiFetch('/airports').then((d) => setAirports(d.airports)).catch(() => { });
    apiFetch('/aircraft-types').then((d) => setAircraftTypes(d.aircraft_types)).catch(() => { });
  }, [refreshKey]);

  useEffect(() => {
    apiFetch('/gates').then((d) => setGates(d.gates)).catch(() => { });
  }, [refreshKey]);

  return (
    <>
      {isAdmin && (
        <ReferenceData
          token={token}
          airports={airports}
          aircraftTypes={aircraftTypes}
          onChange={bump}
        />
      )}
      <GateManager token={token} airports={airports} gates={gates} onChange={bump} />
      <FlightManager token={token} airports={airports} aircraftTypes={aircraftTypes} gates={gates} />
      <ResourceManager token={token} airports={airports} />
    </>
  );
}

// ---------------------------------------------------------------------
// Admin only: add airports / aircraft types. Rarely used after initial
// setup — kept as a small collapsible form rather than a full page.
// ---------------------------------------------------------------------
export function ReferenceData({ token, airports, aircraftTypes, onChange }) {
  const [open, setOpen] = useState(false);
  const [airportForm, setAirportForm] = useState({ name: '', code: '', timezone: 'UTC' });
  const [aircraftForm, setAircraftForm] = useState({ model: '', capacity: '', size_class: 'medium' });
  const [error, setError] = useState(null);

  async function addAirport(e) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/airports', { method: 'POST', token, body: airportForm });
      setAirportForm({ name: '', code: '', timezone: 'UTC' });
      onChange();
    } catch (err) { setError(err.message); }
  }

  async function addAircraftType(e) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/aircraft-types', {
        method: 'POST', token,
        body: { ...aircraftForm, capacity: Number(aircraftForm.capacity) },
      });
      setAircraftForm({ model: '', capacity: '', size_class: 'medium' });
      onChange();
    } catch (err) { setError(err.message); }
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>
        Reference data{' '}
        <button style={styles.buttonSecondary} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Manage'}
        </button>
      </h2>
      <p style={styles.muted}>
        {airports.length} airport(s), {aircraftTypes.length} aircraft type(s) configured.
      </p>
      {error && <p style={styles.error}>{error}</p>}
      {open && (
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <form style={styles.form} onSubmit={addAirport}>
            <strong>Add airport</strong>
            <input style={styles.input} placeholder="Name" value={airportForm.name}
              onChange={(e) => setAirportForm({ ...airportForm, name: e.target.value })} required />
            <input style={styles.input} placeholder="Code (e.g. DEL)" value={airportForm.code}
              onChange={(e) => setAirportForm({ ...airportForm, code: e.target.value })} required />
            <button style={styles.button} type="submit">Add airport</button>
          </form>
          <form style={styles.form} onSubmit={addAircraftType}>
            <strong>Add aircraft type</strong>
            <input style={styles.input} placeholder="Model (e.g. Airbus A320)" value={aircraftForm.model}
              onChange={(e) => setAircraftForm({ ...aircraftForm, model: e.target.value })} required />
            <input style={styles.input} type="number" placeholder="Capacity" value={aircraftForm.capacity}
              onChange={(e) => setAircraftForm({ ...aircraftForm, capacity: e.target.value })} required />
            <select style={styles.select} value={aircraftForm.size_class}
              onChange={(e) => setAircraftForm({ ...aircraftForm, size_class: e.target.value })}>
              {SIZE_CLASSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button style={styles.button} type="submit">Add aircraft type</button>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Gate management: create + list, grouped by airport.
// ---------------------------------------------------------------------
export function GateManager({ token, airports, gates, onChange }) {
  const [form, setForm] = useState({ airport_id: '', code: '', size_class: 'medium' });
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/gates', {
        method: 'POST', token,
        body: { ...form, airport_id: Number(form.airport_id) },
      });
      setForm({ airport_id: form.airport_id, code: '', size_class: 'medium' });
      onChange();
    } catch (err) { setError(err.message); }
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Gates</h2>
      <form style={{ ...styles.form, flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', maxWidth: 'none' }} onSubmit={handleSubmit}>
        <label style={styles.label}>
          Airport
          <select style={styles.select} value={form.airport_id}
            onChange={(e) => setForm({ ...form, airport_id: e.target.value })} required>
            <option value="" disabled>Select</option>
            {airports.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
          </select>
        </label>
        <label style={styles.label}>
          Code
          <input style={styles.input} placeholder="e.g. A1" value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })} required />
        </label>
        <label style={styles.label}>
          Size class
          <select style={styles.select} value={form.size_class}
            onChange={(e) => setForm({ ...form, size_class: e.target.value })}>
            {SIZE_CLASSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button style={styles.button} type="submit">Add gate</button>
      </form>
      {error && <p style={styles.error}>{error}</p>}
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Airport</th><th style={styles.th}>Code</th>
            <th style={styles.th}>Size</th><th style={styles.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {gates.map((g) => {
            const airport = airports.find((a) => a.id === g.airport_id);
            return (
              <tr key={g.id}>
                <td style={styles.td}>{airport?.code || g.airport_id}</td>
                <td style={styles.td}>{g.code}</td>
                <td style={styles.td}>{g.size_class}</td>
                <td style={styles.td}>{g.status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// Flight scheduling: create (auto or manual gate), list, and a detail
// panel showing the auto-generated turnaround checklist. This is the
// centerpiece of the Week 3 demo — creating an overlapping flight on a
// busy gate is what shows the conflict rule working live.
// ---------------------------------------------------------------------
export function FlightManager({ token, airports, aircraftTypes, gates }) {
  const [flights, setFlights] = useState([]);
  const [form, setForm] = useState({
    flight_number: '', aircraft_type_id: '', origin_id: '', dest_id: '',
    scheduled_departure: '', scheduled_arrival: '', gate_id: '',
    base_fare_rupees: '5000', tail_number: '',
  });
  const [autoAssign, setAutoAssign] = useState(true);
  const [error, setError] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [success, setSuccess] = useState(null);
  const [selectedFlightId, setSelectedFlightId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [editingTailNumber, setEditingTailNumber] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const loadFlights = useCallback(() => {
    apiFetch('/flights').then((d) => setFlights(d.flights)).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { loadFlights(); }, [loadFlights]);

  const gatesForOrigin = gates.filter((g) => String(g.airport_id) === String(form.origin_id));

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setConflicts([]);

    const rupees = Number(form.base_fare_rupees);
    if (!Number.isInteger(rupees) || rupees <= 0 || rupees > 500000) {
      setError('Base fare must be a positive integer in rupees (max ₹500,000)');
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        flight_number: form.flight_number,
        aircraft_type_id: Number(form.aircraft_type_id),
        origin_id: Number(form.origin_id),
        dest_id: Number(form.dest_id),
        scheduled_departure: form.scheduled_departure,
        scheduled_arrival: form.scheduled_arrival,
        base_price_cents: rupees * 100,
      };
      if (form.tail_number?.trim()) body.tail_number = form.tail_number.trim();
      if (!autoAssign && form.gate_id) body.gate_id = Number(form.gate_id);

      const result = await apiFetch('/flights', { method: 'POST', token, body });
      setSuccess(
        `Flight ${result.flight.flight_number} created — gate ${result.flight.gate_id} ` +
        `(${result.gate_auto_assigned ? 'auto-assigned' : 'manually assigned'}) at ${formatINR(result.flight.base_price_cents)} base fare.`
      );
      setForm({ ...form, flight_number: '', scheduled_departure: '', scheduled_arrival: '', gate_id: '', base_fare_rupees: '5000', tail_number: '' });
      loadFlights();
    } catch (err) {
      setError(err.message);
      if (err.status === 409 && err.detail?.conflicts) setConflicts(err.detail.conflicts);
    } finally {
      setSubmitting(false);
    }
  }

  async function viewFlight(id) {
    setSelectedFlightId(id);
    setEditingTailNumber(null);
    try {
      const detail = await apiFetch(`/flights/${id}`);
      setSelectedDetail(detail);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveTailNumber(flightId) {
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch(`/flights/${flightId}`, {
        method: 'PATCH',
        token,
        body: { tail_number: editingTailNumber.trim() || null },
      });
      setEditingTailNumber(null);
      setSuccess(`Updated tail number for ${res.flight.flight_number}.`);
      loadFlights();
      if (selectedFlightId === flightId) {
        viewFlight(flightId);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Flights</h2>
      <form style={styles.form} onSubmit={handleSubmit}>
        <label style={styles.label}>
          Flight number
          <input style={styles.input} value={form.flight_number}
            onChange={(e) => setForm({ ...form, flight_number: e.target.value })} required />
        </label>
        <label style={styles.label}>
          Aircraft type
          <select style={styles.select} value={form.aircraft_type_id}
            onChange={(e) => setForm({ ...form, aircraft_type_id: e.target.value })} required>
            <option value="" disabled>Select</option>
            {aircraftTypes.map((a) => (
              <option key={a.id} value={a.id}>{a.model} ({a.size_class})</option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={styles.label}>Origin</label>
          <div style={{ ...styles.input, padding: '4px 8px' }}>
            <AirportSelect
              value={form.origin_id}
              valueKey="id"
              airports={airports}
              onChange={(id) => setForm({ ...form, origin_id: id, gate_id: '' })}
              placeholder="Select origin airport"
              required
            />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={styles.label}>Destination</label>
          <div style={{ ...styles.input, padding: '4px 8px' }}>
            <AirportSelect
              value={form.dest_id}
              valueKey="id"
              airports={airports}
              onChange={(id) => setForm({ ...form, dest_id: id })}
              placeholder="Select destination airport"
              required
            />
          </div>
        </div>
        <DateTimePicker
          label="Scheduled departure"
          value={form.scheduled_departure}
          onChange={(val) => setForm({ ...form, scheduled_departure: val })}
          required
        />
        <DateTimePicker
          label="Scheduled arrival"
          value={form.scheduled_arrival}
          onChange={(val) => setForm({ ...form, scheduled_arrival: val })}
          required
        />
        <label style={styles.label}>
          Base fare (₹)
          <input
            style={styles.input}
            type="number"
            min="1"
            max="500000"
            step="1"
            value={form.base_fare_rupees}
            onChange={(e) => setForm({ ...form, base_fare_rupees: e.target.value })}
            placeholder="e.g. 4500"
            required
          />
        </label>
        <label style={{ ...styles.label, flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
          <input type="checkbox" checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} />
          Auto-assign gate (recommended)
        </label>
        {!autoAssign && (
          <label style={styles.label}>
            Gate
            <select style={styles.select} value={form.gate_id}
              onChange={(e) => setForm({ ...form, gate_id: e.target.value })} required={!autoAssign}>
              <option value="" disabled>Select</option>
              {gatesForOrigin.map((g) => (
                <option key={g.id} value={g.id}>{g.code} ({g.size_class}, {g.status})</option>
              ))}
            </select>
          </label>
        )}
        {error && <p style={styles.error}>{error}</p>}
        {success && <p style={styles.success}>{success}</p>}
        {conflicts.length > 0 && (
          <div>
            <p style={styles.error}>Conflicting flight(s) on this gate:</p>
            <ul>
              {conflicts.map((c) => (
                <li key={c.id} style={styles.muted}>
                  {c.flight_number} — departs {formatDateTime(c.scheduled_departure)}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button style={styles.button} type="submit" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create flight'}
        </button>
      </form>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Flight</th><th style={styles.th}>Route</th>
            <th style={styles.th}>Departs</th><th style={styles.th}>Base Fare</th><th style={styles.th}>Gate</th>
            <th style={styles.th}>Tail #</th><th style={styles.th}>Status</th><th style={styles.th}></th>
          </tr>
        </thead>
        <tbody>
          {flights.map((f) => (
            <tr key={f.id}>
              <td style={styles.td}>{f.flight_number}</td>
              <td style={styles.td}>{f.origin_code} → {f.dest_code}</td>
              <td style={styles.td}>{formatDateTime(f.scheduled_departure)}</td>
              <td style={styles.td}>{formatINR(f.base_price_cents)}</td>
              <td style={styles.td}>{f.gate_code || '—'}</td>
              <td style={styles.td}>{f.tail_number || '—'}</td>
              <td style={styles.td}>{f.status}</td>
              <td style={styles.td}>
                <button style={styles.buttonSecondary} onClick={() => viewFlight(f.id)}>Details</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedFlightId && selectedDetail && (
        <div style={{ marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
          <h3 style={styles.cardTitle}>Turnaround checklist — {selectedDetail.flight.flight_number}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <span style={styles.muted}>Tail #:</span>
            {editingTailNumber !== null ? (
              <>
                <input
                  style={{ ...styles.input, width: '140px' }}
                  value={editingTailNumber}
                  onChange={(e) => setEditingTailNumber(e.target.value.toUpperCase())}
                  placeholder="VT-ABC"
                  maxLength={20}
                />
                <button style={styles.button} type="button" onClick={() => saveTailNumber(selectedDetail.flight.id)}>
                  Save
                </button>
                <button style={styles.buttonSecondary} type="button" onClick={() => setEditingTailNumber(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <strong>{selectedDetail.flight.tail_number || '—'}</strong>
                <button
                  style={styles.buttonSecondary}
                  type="button"
                  onClick={() => setEditingTailNumber(selectedDetail.flight.tail_number || '')}
                >
                  Edit tail #
                </button>
              </>
            )}
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Step</th><th style={styles.th}>Status</th>
                <th style={styles.th}>Team</th><th style={styles.th}>Est.</th><th style={styles.th}>Actual</th>
              </tr>
            </thead>
            <tbody>
              {selectedDetail.turnaround_checklist.map((s) => (
                <tr key={s.id}>
                  <td style={styles.td}>{s.step}</td>
                  <td style={styles.td}>{s.status}</td>
                  <td style={styles.td}>{s.assigned_team || '—'}</td>
                  <td style={styles.td}>{s.est_duration?.minutes ?? '—'} min</td>
                  <td style={styles.td}>{s.actual_duration?.minutes ?? '—'} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Resource allocation: fuel trucks / baggage carts / crew, assigned to
// flights with the same overlap-conflict pattern as gates and shifts.
// ---------------------------------------------------------------------
export function ResourceManager({ token, airports }) {
  const [resources, setResources] = useState([]);
  const [flights, setFlights] = useState([]);
  const [assignments, setAssignments] = useState([]);

  const [resourceForm, setResourceForm] = useState({ airport_id: '', type: 'fuel_truck' });
  const [resourceTouched, setResourceTouched] = useState({});
  const [resourceServerError, setResourceServerError] = useState(null);
  const [addingResource, setAddingResource] = useState(false);

  const [assignForm, setAssignForm] = useState({ resource_id: '', flight_id: '', start_time: '', end_time: '' });
  const [assignTouched, setAssignTouched] = useState({});
  const [assignServerError, setAssignServerError] = useState(null);
  const [assigningResource, setAssigningResource] = useState(false);
  const [conflicts, setConflicts] = useState([]);

  const loadResources = useCallback(() => {
    apiFetch('/resources', { token })
      .then((d) => setResources(d.resources || []))
      .catch((err) => setResourceServerError(err.message));
  }, [token]);

  const loadFlights = useCallback(() => {
    apiFetch('/flights?limit=200', { token })
      .then((d) => setFlights(d.flights || []))
      .catch(() => { });
  }, [token]);

  useEffect(() => {
    loadResources();
    loadFlights();
  }, [loadResources, loadFlights]);

  const assignValidation = validateResourceAssignmentForm(assignForm);
  const resourceValidation = validateAddResourceForm(resourceForm);
  const assignableFlights = flights.filter((f) => isFlightAssignable(f));

  async function addResource(e) {
    e.preventDefault();
    setResourceServerError(null);
    setResourceTouched({ airport_id: true, type: true });
    if (!resourceValidation.isValid) return;

    setAddingResource(true);
    try {
      await apiFetch('/resources', {
        method: 'POST',
        token,
        body: { ...resourceForm, airport_id: Number(resourceForm.airport_id) },
      });
      loadResources();
      setResourceForm({ airport_id: '', type: 'fuel_truck' });
      setResourceTouched({});
    } catch (err) {
      setResourceServerError(err.message || 'Could not create resource');
    } finally {
      setAddingResource(false);
    }
  }

  async function assignResource(e) {
    e.preventDefault();
    setAssignServerError(null);
    setConflicts([]);
    setAssignTouched({ resource_id: true, flight_id: true, start_time: true, end_time: true });
    if (!assignValidation.isValid) return;

    setAssigningResource(true);
    try {
      const result = await apiFetch('/resource-assignments', {
        method: 'POST',
        token,
        body: {
          resource_id: Number(assignForm.resource_id),
          flight_id: Number(assignForm.flight_id),
          start_time: assignForm.start_time,
          end_time: assignForm.end_time,
        },
      });
      setAssignments((prev) => [...prev, result.resource_assignment]);
      setAssignForm({ resource_id: '', flight_id: '', start_time: '', end_time: '' });
      setAssignTouched({});
    } catch (err) {
      setAssignServerError(err.message || 'Could not create resource assignment');
      if (err.status === 409 && err.detail?.conflicts) {
        setConflicts(err.detail.conflicts);
      }
    } finally {
      setAssigningResource(false);
    }
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Resources (fuel trucks, baggage carts, crew)</h2>
      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        {/* Add Resource Form */}
        <form style={styles.form} onSubmit={addResource}>
          <strong>Add resource</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <select
              style={styles.select}
              value={resourceForm.airport_id}
              onChange={(e) => {
                setResourceForm({ ...resourceForm, airport_id: e.target.value });
                setResourceTouched((prev) => ({ ...prev, airport_id: true }));
              }}
              onBlur={() => setResourceTouched((prev) => ({ ...prev, airport_id: true }))}
            >
              <option value="" disabled>Select airport...</option>
              {airports.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} ({a.city || a.name})
                </option>
              ))}
            </select>
            {resourceTouched.airport_id && resourceValidation.errors.airport_id && (
              <span style={{ color: 'var(--color-error)', fontSize: '11px' }}>
                {resourceValidation.errors.airport_id}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <select
              style={styles.select}
              value={resourceForm.type}
              onChange={(e) => {
                setResourceForm({ ...resourceForm, type: e.target.value });
                setResourceTouched((prev) => ({ ...prev, type: true }));
              }}
            >
              {ALLOWED_RESOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </select>
            {resourceTouched.type && resourceValidation.errors.type && (
              <span style={{ color: 'var(--color-error)', fontSize: '11px' }}>
                {resourceValidation.errors.type}
              </span>
            )}
          </div>

          <button
            style={styles.button}
            type="submit"
            disabled={!resourceValidation.isValid || addingResource}
          >
            {addingResource ? 'Adding...' : 'Add resource'}
          </button>

          {resourceServerError && (
            <p style={{ color: 'var(--color-error)', fontSize: '12.5px', margin: '4px 0' }}>
              {resourceServerError}
            </p>
          )}
        </form>

        {/* Assign Resource Form */}
        <form style={styles.form} onSubmit={assignResource}>
          <strong>Assign to flight</strong>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <label style={styles.label}>
              Resource
              <select
                style={styles.select}
                value={assignForm.resource_id}
                onChange={(e) => {
                  setAssignForm({ ...assignForm, resource_id: e.target.value });
                  setAssignTouched((prev) => ({ ...prev, resource_id: true }));
                }}
                onBlur={() => setAssignTouched((prev) => ({ ...prev, resource_id: true }))}
              >
                <option value="" disabled>Select resource...</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id} disabled={r.status === 'maintenance'}>
                    {formatResourceOption(r, airports)}
                  </option>
                ))}
              </select>
            </label>
            {assignTouched.resource_id && assignValidation.errors.resource_id && (
              <span style={{ color: 'var(--color-error)', fontSize: '11px' }}>
                {assignValidation.errors.resource_id}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <label style={styles.label}>
              Flight
              <select
                style={styles.select}
                value={assignForm.flight_id}
                onChange={(e) => {
                  setAssignForm({ ...assignForm, flight_id: e.target.value });
                  setAssignTouched((prev) => ({ ...prev, flight_id: true }));
                }}
                onBlur={() => setAssignTouched((prev) => ({ ...prev, flight_id: true }))}
              >
                <option value="" disabled>Select assignable flight...</option>
                {assignableFlights.map((f) => (
                  <option key={f.id} value={f.id}>
                    {formatFlightOption(f, formatDateTime)}
                  </option>
                ))}
              </select>
            </label>
            {assignTouched.flight_id && assignValidation.errors.flight_id && (
              <span style={{ color: 'var(--color-error)', fontSize: '11px' }}>
                {assignValidation.errors.flight_id}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <DateTimePicker
              label="Start time"
              value={assignForm.start_time}
              onChange={(val) => {
                setAssignForm({ ...assignForm, start_time: val });
                setAssignTouched((prev) => ({ ...prev, start_time: true }));
              }}
              required
            />
            {assignTouched.start_time && assignValidation.errors.start_time && (
              <span style={{ color: 'var(--color-error)', fontSize: '11px' }}>
                {assignValidation.errors.start_time}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <DateTimePicker
              label="End time"
              value={assignForm.end_time}
              onChange={(val) => {
                setAssignForm({ ...assignForm, end_time: val });
                setAssignTouched((prev) => ({ ...prev, end_time: true }));
              }}
              required
            />
            {assignTouched.end_time && assignValidation.errors.end_time && (
              <span style={{ color: 'var(--color-error)', fontSize: '11px' }}>
                {assignValidation.errors.end_time}
              </span>
            )}
          </div>

          <button
            style={styles.button}
            type="submit"
            disabled={!assignValidation.isValid || assigningResource}
          >
            {assigningResource ? 'Assigning...' : 'Assign'}
          </button>

          {assignServerError && (
            <p style={{ color: 'var(--color-error)', fontSize: '12.5px', margin: '4px 0' }}>
              {assignServerError}
            </p>
          )}

          {conflicts.length > 0 && (
            <div style={{ marginTop: '4px' }}>
              <p style={{ color: 'var(--color-error)', fontSize: '12px', margin: '2px 0', fontWeight: 600 }}>
                This resource is already booked then:
              </p>
              <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--color-slate)', fontSize: '11.5px' }}>
                {conflicts.map((c) => (
                  <li key={c.id}>
                    Flight #{c.flight_id}: {formatDateTime(c.start_time)} – {formatDateTime(c.end_time)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      </div>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>ID</th>
            <th style={styles.th}>Type</th>
            <th style={styles.th}>Airport</th>
            <th style={styles.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => {
            const ap = airports?.find((a) => a.id === r.airport_id);
            return (
              <tr key={r.id}>
                <td style={styles.td}>#{r.id}</td>
                <td style={styles.td}>{r.type.replace('_', ' ')}</td>
                <td style={styles.td}>{ap ? `${ap.code} (${ap.city || ap.name})` : `#${r.airport_id}`}</td>
                <td style={styles.td}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      background:
                        r.status === 'available'
                          ? 'var(--color-success-bg)'
                          : r.status === 'in_use'
                            ? 'var(--color-primary-fixed)'
                            : 'var(--color-warn-bg)',
                      color:
                        r.status === 'available'
                          ? 'var(--color-success-text)'
                          : r.status === 'in_use'
                            ? 'var(--color-primary)'
                            : 'var(--color-warn-text)',
                    }}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// Ground crew: their turnaround task queue across all flights. Simple
// on purpose — Week 3 doesn't assign specific steps to specific
// employees, just role-gates who can update status (see turnaround.js).
// ---------------------------------------------------------------------
export function TurnaroundBoard({ token }) {
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    apiFetch('/turnaround', { token }).then((d) => setSteps(d.turnaround_checklist)).catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function markDone(step) {
    setBusyId(step.id);
    setError(null);
    try {
      await apiFetch(`/turnaround/${step.id}/status`, {
        method: 'PATCH', token, body: { status: 'done' },
      });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const pending = steps.filter((s) => s.status !== 'done' && s.status !== 'skipped');

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Turnaround tasks</h2>
      {error && <p style={styles.error}>{error}</p>}
      {pending.length === 0 && <p style={styles.muted}>Nothing pending.</p>}
      {pending.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr><th style={styles.th}>Flight</th><th style={styles.th}>Step</th><th style={styles.th}>Status</th><th style={styles.th}></th></tr>
          </thead>
          <tbody>
            {pending.map((s) => (
              <tr key={s.id}>
                <td style={styles.td}>#{s.flight_id}</td>
                <td style={styles.td}>{s.step}</td>
                <td style={styles.td}>{s.status}</td>
                <td style={styles.td}>
                  <button style={styles.buttonSecondary} disabled={busyId === s.id} onClick={() => markDone(s)}>
                    Mark done
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
