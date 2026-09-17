import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { styles } from '../styles.js';

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
    apiFetch('/airports').then((d) => setAirports(d.airports)).catch(() => {});
    apiFetch('/aircraft-types').then((d) => setAircraftTypes(d.aircraft_types)).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    apiFetch('/gates').then((d) => setGates(d.gates)).catch(() => {});
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
  });
  const [autoAssign, setAutoAssign] = useState(true);
  const [error, setError] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [success, setSuccess] = useState(null);
  const [selectedFlightId, setSelectedFlightId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
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
    setSubmitting(true);
    try {
      const body = {
        flight_number: form.flight_number,
        aircraft_type_id: Number(form.aircraft_type_id),
        origin_id: Number(form.origin_id),
        dest_id: Number(form.dest_id),
        scheduled_departure: form.scheduled_departure,
        scheduled_arrival: form.scheduled_arrival,
      };
      if (!autoAssign && form.gate_id) body.gate_id = Number(form.gate_id);

      const result = await apiFetch('/flights', { method: 'POST', token, body });
      setSuccess(
        `Flight ${result.flight.flight_number} created — gate ${result.flight.gate_id} ` +
        `(${result.gate_auto_assigned ? 'auto-assigned' : 'manually assigned'}).`
      );
      setForm({ ...form, flight_number: '', scheduled_departure: '', scheduled_arrival: '', gate_id: '' });
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
    try {
      const detail = await apiFetch(`/flights/${id}`);
      setSelectedDetail(detail);
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
        <label style={styles.label}>
          Origin
          <select style={styles.select} value={form.origin_id}
            onChange={(e) => setForm({ ...form, origin_id: e.target.value, gate_id: '' })} required>
            <option value="" disabled>Select</option>
            {airports.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
          </select>
        </label>
        <label style={styles.label}>
          Destination
          <select style={styles.select} value={form.dest_id}
            onChange={(e) => setForm({ ...form, dest_id: e.target.value })} required>
            <option value="" disabled>Select</option>
            {airports.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
          </select>
        </label>
        <label style={styles.label}>
          Scheduled departure
          <input style={styles.input} type="datetime-local" value={form.scheduled_departure}
            onChange={(e) => setForm({ ...form, scheduled_departure: e.target.value })} required />
        </label>
        <label style={styles.label}>
          Scheduled arrival
          <input style={styles.input} type="datetime-local" value={form.scheduled_arrival}
            onChange={(e) => setForm({ ...form, scheduled_arrival: e.target.value })} required />
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
                  {c.flight_number} — departs {new Date(c.scheduled_departure).toLocaleString()}
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
            <th style={styles.th}>Departs</th><th style={styles.th}>Gate</th>
            <th style={styles.th}>Status</th><th style={styles.th}></th>
          </tr>
        </thead>
        <tbody>
          {flights.map((f) => (
            <tr key={f.id}>
              <td style={styles.td}>{f.flight_number}</td>
              <td style={styles.td}>{f.origin_code} → {f.dest_code}</td>
              <td style={styles.td}>{new Date(f.scheduled_departure).toLocaleString()}</td>
              <td style={styles.td}>{f.gate_code || '—'}</td>
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
  const [assignments, setAssignments] = useState([]);
  const [resourceForm, setResourceForm] = useState({ airport_id: '', type: 'fuel_truck' });
  const [assignForm, setAssignForm] = useState({ resource_id: '', flight_id: '', start_time: '', end_time: '' });
  const [error, setError] = useState(null);
  const [conflicts, setConflicts] = useState([]);

  const loadResources = useCallback(() => {
    apiFetch('/resources', { token }).then((d) => setResources(d.resources)).catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => { loadResources(); }, [loadResources]);

  async function addResource(e) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/resources', {
        method: 'POST', token,
        body: { ...resourceForm, airport_id: Number(resourceForm.airport_id) },
      });
      loadResources();
    } catch (err) { setError(err.message); }
  }

  async function assignResource(e) {
    e.preventDefault();
    setError(null);
    setConflicts([]);
    try {
      const result = await apiFetch('/resource-assignments', {
        method: 'POST', token,
        body: {
          resource_id: Number(assignForm.resource_id),
          flight_id: Number(assignForm.flight_id),
          start_time: assignForm.start_time,
          end_time: assignForm.end_time,
        },
      });
      setAssignments((prev) => [...prev, result.resource_assignment]);
      setAssignForm({ ...assignForm, flight_id: '', start_time: '', end_time: '' });
    } catch (err) {
      setError(err.message);
      if (err.status === 409 && err.detail?.conflicts) setConflicts(err.detail.conflicts);
    }
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Resources (fuel trucks, baggage carts, crew)</h2>
      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        <form style={styles.form} onSubmit={addResource}>
          <strong>Add resource</strong>
          <select style={styles.select} value={resourceForm.airport_id}
            onChange={(e) => setResourceForm({ ...resourceForm, airport_id: e.target.value })} required>
            <option value="" disabled>Airport</option>
            {airports.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
          </select>
          <select style={styles.select} value={resourceForm.type}
            onChange={(e) => setResourceForm({ ...resourceForm, type: e.target.value })}>
            {['fuel_truck', 'baggage_cart', 'crew', 'catering_truck', 'pushback_tug'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button style={styles.button} type="submit">Add resource</button>
        </form>

        <form style={styles.form} onSubmit={assignResource}>
          <strong>Assign to flight (by flight id)</strong>
          <select style={styles.select} value={assignForm.resource_id}
            onChange={(e) => setAssignForm({ ...assignForm, resource_id: e.target.value })} required>
            <option value="" disabled>Resource</option>
            {resources.map((r) => <option key={r.id} value={r.id}>#{r.id} {r.type} ({r.status})</option>)}
          </select>
          <input style={styles.input} type="number" placeholder="Flight ID" value={assignForm.flight_id}
            onChange={(e) => setAssignForm({ ...assignForm, flight_id: e.target.value })} required />
          <input style={styles.input} type="datetime-local" value={assignForm.start_time}
            onChange={(e) => setAssignForm({ ...assignForm, start_time: e.target.value })} required />
          <input style={styles.input} type="datetime-local" value={assignForm.end_time}
            onChange={(e) => setAssignForm({ ...assignForm, end_time: e.target.value })} required />
          <button style={styles.button} type="submit">Assign</button>
        </form>
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {conflicts.length > 0 && (
        <div>
          <p style={styles.error}>This resource is already booked then:</p>
          <ul>
            {conflicts.map((c) => (
              <li key={c.id} style={styles.muted}>
                Flight #{c.flight_id}: {new Date(c.start_time).toLocaleString()} – {new Date(c.end_time).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      )}
      <table style={styles.table}>
        <thead><tr><th style={styles.th}>ID</th><th style={styles.th}>Type</th><th style={styles.th}>Status</th></tr></thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r.id}><td style={styles.td}>{r.id}</td><td style={styles.td}>{r.type}</td><td style={styles.td}>{r.status}</td></tr>
          ))}
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
