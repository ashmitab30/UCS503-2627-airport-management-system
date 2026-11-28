import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { styles } from '../styles.js';
import { formatDateTime } from '../utils/format.js';

const TYPES = ['medical', 'security', 'weather', 'technical', 'fire'];

const ACTION_META = {
  declared: { label: 'DECLARED', pillClass: 'status-pill-red', icon: 'emergency' },
  alert_sent: { label: 'ALERT SENT', pillClass: 'status-pill-blue', icon: 'campaign' },
  acknowledged: { label: 'ACKNOWLEDGED', pillClass: 'status-pill-amber', icon: 'check_circle' },
  note_added: { label: 'NOTE ADDED', pillClass: 'status-pill-slate', icon: 'chat' },
  resolved: { label: 'RESOLVED', pillClass: 'status-pill-green', icon: 'task_alt' },
};

export default function EmergencyBoard({ token }) {
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'resolved'
  const [emergencies, setEmergencies] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Declare-new form state
  const [type, setType] = useState('medical');
  const [flightId, setFlightId] = useState('');
  const [gateId, setGateId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  // Audit trail drawer state
  const [auditOpen, setAuditOpen] = useState({});
  const [auditTrails, setAuditTrails] = useState({});
  const [auditLoading, setAuditLoading] = useState({});
  const [auditError, setAuditError] = useState({});

  // Add-note form state per emergency
  const [noteInputs, setNoteInputs] = useState({});
  const [noteSubmitting, setNoteSubmitting] = useState({});
  const [noteErrors, setNoteErrors] = useState({});

  // Resolve modal state
  const [resolveModalId, setResolveModalId] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const load = useCallback(() => {
    apiFetch(`/emergencies?status=${statusFilter}`, { token })
      .then((data) => setEmergencies(data.emergencies))
      .catch((err) => setError(err.message));
  }, [token, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDeclare(e) {
    e.preventDefault();
    if (!flightId && !gateId) {
      setError('Please provide at least a Flight ID or Gate ID for dispatch.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/emergencies', {
        method: 'POST',
        token,
        body: {
          type,
          flight_id: flightId || undefined,
          gate_id: gateId || undefined,
          notes: notes || undefined,
        },
      });
      setFlightId('');
      setGateId('');
      setNotes('');
      setFormOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolve(id, notesToSubmit = '') {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/emergencies/${id}/resolve`, {
        method: 'PATCH',
        token,
        body: notesToSubmit ? { resolution_notes: notesToSubmit } : {},
      });
      load();
      if (auditOpen[id]) {
        loadAudit(id);
      }
      setResolveModalId(null);
      setResolutionNotes('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function loadAudit(id) {
    setAuditLoading((prev) => ({ ...prev, [id]: true }));
    setAuditError((prev) => ({ ...prev, [id]: null }));
    try {
      const res = await apiFetch(`/emergencies/${id}/audit`, { token });
      setAuditTrails((prev) => ({ ...prev, [id]: res.audit || [] }));
    } catch (err) {
      setAuditError((prev) => ({ ...prev, [id]: err.message || 'Could not load audit trail' }));
    } finally {
      setAuditLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  function toggleAudit(id) {
    const next = !auditOpen[id];
    setAuditOpen((prev) => ({ ...prev, [id]: next }));
    if (next && !auditTrails[id]) {
      loadAudit(id);
    }
  }

  async function handleAddNote(id) {
    const text = (noteInputs[id] || '').trim();
    if (!text) {
      setNoteErrors((prev) => ({ ...prev, [id]: 'Please enter note text' }));
      return;
    }
    if (text.length > 500) {
      setNoteErrors((prev) => ({ ...prev, [id]: 'Note cannot exceed 500 characters' }));
      return;
    }

    setNoteSubmitting((prev) => ({ ...prev, [id]: true }));
    setNoteErrors((prev) => ({ ...prev, [id]: null }));
    try {
      const res = await apiFetch(`/emergencies/${id}/notes`, {
        method: 'POST',
        token,
        body: { note: text },
      });
      if (res.audit) {
        setAuditTrails((prev) => ({
          ...prev,
          [id]: [...(prev[id] || []), res.audit],
        }));
      } else {
        loadAudit(id);
      }
      setNoteInputs((prev) => ({ ...prev, [id]: '' }));
    } catch (err) {
      setNoteErrors((prev) => ({ ...prev, [id]: err.message || 'Could not add note' }));
    } finally {
      setNoteSubmitting((prev) => ({ ...prev, [id]: false }));
    }
  }

  return (
    <div style={styles.card}>
      {/* Top Header & Declare Button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--color-error)', fontSize: '26px' }}>
            warning
          </span>
          <h2 style={{ ...styles.cardTitle, margin: 0 }}>Emergency & Incident Management</h2>
        </div>

        <button
          type="button"
          onClick={() => setFormOpen(!formOpen)}
          className="btn-primary-aero"
          style={{
            background: formOpen ? 'var(--color-surface-low)' : 'var(--color-error)',
            color: formOpen ? 'var(--color-on-surface)' : '#fff',
            boxShadow: formOpen ? 'none' : '0 4px 14px rgba(186, 26, 26, 0.35)',
            padding: '8px 18px',
            fontSize: '13px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
            {formOpen ? 'close' : 'emergency'}
          </span>
          <span>{formOpen ? 'Close Form' : 'Declare Emergency'}</span>
        </button>
      </div>

      {/* Filter Tabs: Active vs Resolved */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', borderBottom: '1px solid var(--color-surface-variant)', paddingBottom: '8px' }}>
        <button
          type="button"
          onClick={() => setStatusFilter('active')}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 700,
            border: 'none',
            background: statusFilter === 'active' ? 'var(--color-error)' : 'transparent',
            color: statusFilter === 'active' ? '#ffffff' : 'var(--color-slate)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>emergency</span>
          <span>Active Queue</span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('resolved')}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 700,
            border: 'none',
            background: statusFilter === 'resolved' ? 'var(--color-primary)' : 'transparent',
            color: statusFilter === 'resolved' ? '#ffffff' : 'var(--color-slate)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>task_alt</span>
          <span>Resolved Archive</span>
        </button>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {/* Declare Emergency Form */}
      {formOpen && (
        <form
          onSubmit={handleDeclare}
          style={{
            padding: '20px',
            background: 'var(--color-error-container)',
            borderRadius: '16px',
            marginBottom: '20px',
            border: '1px solid rgba(186, 26, 26, 0.2)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
            <label style={styles.label}>
              <span>Incident Type</span>
              <select style={styles.select} value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t.toUpperCase()}</option>
                ))}
              </select>
            </label>

            <label style={styles.label}>
              <span>Flight ID (optional)</span>
              <input style={styles.input} placeholder="e.g. 1" value={flightId} onChange={(e) => setFlightId(e.target.value)} />
            </label>

            <label style={styles.label}>
              <span>Gate ID (optional)</span>
              <input style={styles.input} placeholder="e.g. 1" value={gateId} onChange={(e) => setGateId(e.target.value)} />
            </label>

            <label style={{ ...styles.label, gridColumn: '1 / -1' }}>
              <span>Dispatcher Dispatch Notes</span>
              <input style={styles.input} placeholder="Brief operational description of the incident" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>

          <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary-aero"
              style={{ background: 'var(--color-error)', padding: '10px 24px', fontSize: '13.5px' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>emergency</span>
              <span>{submitting ? 'Declaring…' : 'Dispatch Emergency Team'}</span>
            </button>
          </div>
        </form>
      )}

      {/* List of emergencies */}
      {emergencies === null && <p style={styles.muted}>Loading incident queue…</p>}
      {emergencies && emergencies.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-slate)', background: 'var(--color-surface-low)', borderRadius: '14px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '32px', color: 'var(--color-success)', marginBottom: '4px' }}>
            check_circle
          </span>
          <p style={{ margin: 0, fontWeight: 700 }}>
            {statusFilter === 'active' ? 'No active airport emergencies reported.' : 'No resolved emergency records found.'}
          </p>
          <span style={{ fontSize: '12px', color: 'var(--color-outline)' }}>
            {statusFilter === 'active' ? 'All sectors normal and operational.' : 'Emergency archives are currently clear.'}
          </span>
        </div>
      )}

      {emergencies && emergencies.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {emergencies.map((em) => {
            const isActive = em.status === 'active';
            const isAuditOpen = Boolean(auditOpen[em.id]);
            const trail = auditTrails[em.id] || [];
            const isLoadingAudit = Boolean(auditLoading[em.id]);
            const curAuditError = auditError[em.id];
            const curNoteError = noteErrors[em.id];
            const curNote = noteInputs[em.id] || '';
            const isNoteSubmitting = Boolean(noteSubmitting[em.id]);

            return (
              <div
                key={em.id}
                style={{
                  borderRadius: '14px',
                  background: 'var(--color-surface-lowest)',
                  border: isActive ? '1.5px solid var(--color-error)' : '1px solid var(--color-outline-variant, #e2e8f0)',
                  boxShadow: isActive ? '0 4px 16px rgba(186, 26, 26, 0.08)' : '0 2px 8px rgba(0, 0, 0, 0.04)',
                  overflow: 'hidden',
                }}
              >
                {/* Main Card Header */}
                <div
                  style={{
                    padding: '18px 22px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '14px',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span className={`status-pill ${isActive ? 'status-pill-red' : 'status-pill-green'}`}>
                        <span className={`dot-indicator ${isActive ? 'red' : 'green'}`} />
                        {em.type.toUpperCase()} EMERGENCY
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-outline)' }}>
                        Incident #{em.id}
                      </span>
                      <span className="status-pill status-pill-slate">
                        Status: {em.status.toUpperCase()}
                      </span>
                    </div>

                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                      {em.notes || 'Emergency dispatched by airport operations team.'}
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '4px' }}>
                      {em.flight_number && <span>Flight {em.flight_number} &middot; </span>}
                      {em.gate_code && <span>Gate {em.gate_code} &middot; </span>}
                      <span>Declared {formatDateTime(em.declared_at)}</span>
                      {em.resolved_at && <span> &middot; Resolved {formatDateTime(em.resolved_at)}</span>}
                      {em.declared_by_name && <span> (by {em.declared_by_name})</span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => toggleAudit(em.id)}
                      className="btn-glass"
                      style={{ padding: '8px 14px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>history</span>
                      <span>{isAuditOpen ? 'Hide Audit Trail' : 'Audit Trail'}</span>
                    </button>

                    {isActive && (
                      <button
                        type="button"
                        className="btn-primary-aero"
                        style={{ background: 'var(--color-success)', padding: '8px 18px', fontSize: '12.5px' }}
                        disabled={busyId === em.id}
                        onClick={() => setResolveModalId(em.id)}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>task_alt</span>
                        <span>{busyId === em.id ? 'Resolving…' : 'Mark Resolved'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Resolve Modal / Inline Form */}
                {resolveModalId === em.id && (
                  <div
                    style={{
                      padding: '14px 22px',
                      background: 'var(--color-surface-low)',
                      borderTop: '1px solid var(--color-surface-variant)',
                      borderBottom: '1px solid var(--color-surface-variant)',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>
                      Resolve Incident #{em.id}
                    </div>
                    <input
                      style={{ ...styles.input, marginBottom: '8px' }}
                      placeholder="Optional resolution notes (e.g. Passenger stabilized; gate inspected and cleared)"
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn-glass"
                        onClick={() => {
                          setResolveModalId(null);
                          setResolutionNotes('');
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn-primary-aero"
                        style={{ background: 'var(--color-success)' }}
                        disabled={busyId === em.id}
                        onClick={() => handleResolve(em.id, resolutionNotes)}
                      >
                        Confirm Resolution
                      </button>
                    </div>
                  </div>
                )}

                {/* Audit Trail Drawer / Panel */}
                {isAuditOpen && (
                  <div
                    style={{
                      borderTop: '1px solid var(--color-surface-variant)',
                      background: 'var(--color-surface-low, #f8fafc)',
                      padding: '16px 22px',
                    }}
                    data-testid={`audit-panel-${em.id}`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-slate)' }}>
                        Official Audit Trail & Action Timeline
                      </h4>
                      <button
                        type="button"
                        onClick={() => loadAudit(em.id)}
                        className="btn-glass"
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                      >
                        Refresh
                      </button>
                    </div>

                    {isLoadingAudit && <p style={{ fontSize: '12px', color: 'var(--color-slate)' }}>Loading timeline…</p>}
                    {curAuditError && <p style={{ fontSize: '12px', color: 'var(--color-critical)' }}>{curAuditError}</p>}

                    {!isLoadingAudit && trail.length === 0 && !curAuditError && (
                      <p style={{ fontSize: '12px', color: 'var(--color-outline)' }}>No audit events logged yet.</p>
                    )}

                    {!isLoadingAudit && trail.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                        {trail.map((entry, idx) => {
                          const meta = ACTION_META[entry.action] || {
                            label: entry.action.toUpperCase(),
                            pillClass: 'status-pill-slate',
                            icon: 'event',
                          };
                          const details = entry.details || {};

                          return (
                            <div
                              key={entry.id || idx}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '10px',
                                padding: '10px 12px',
                                background: 'var(--color-surface-lowest, #ffffff)',
                                borderRadius: '8px',
                                border: '1px solid var(--color-outline-variant, #e2e8f0)',
                                fontSize: '12px',
                              }}
                            >
                              <span className={`status-pill ${meta.pillClass}`} style={{ fontSize: '10px', padding: '2px 6px' }}>
                                {meta.label}
                              </span>

                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                                  <span style={{ fontWeight: 700, color: 'var(--color-on-surface)' }}>
                                    {entry.actor_name || 'System'}
                                    {entry.actor_role && (
                                      <span style={{ fontWeight: 400, color: 'var(--color-slate)', marginLeft: '6px' }}>
                                        ({entry.actor_role.replace('_', ' ')})
                                      </span>
                                    )}
                                  </span>
                                  <span style={{ fontSize: '11px', color: 'var(--color-outline)' }}>
                                    {formatDateTime(entry.created_at)}
                                  </span>
                                </div>

                                {/* Details presentation */}
                                <div style={{ color: 'var(--color-slate)', marginTop: '2px' }}>
                                  {entry.action === 'declared' && (
                                    <span>
                                      Declared incident (Type: {details.type || em.type}
                                      {details.flight_id ? ` · Flight #${details.flight_id}` : ''}
                                      {details.gate_id ? ` · Gate #${details.gate_id}` : ''})
                                      {details.notes ? `: "${details.notes}"` : ''}
                                    </span>
                                  )}
                                  {entry.action === 'alert_sent' && (
                                    <span>
                                      Alert dispatched to role: <strong>{details.recipient_role || 'Staff'}</strong>
                                    </span>
                                  )}
                                  {entry.action === 'acknowledged' && (
                                    <span>
                                      Alert acknowledged for role: <strong>{details.recipient_role || entry.actor_role}</strong>
                                    </span>
                                  )}
                                  {entry.action === 'note_added' && (
                                    <span style={{ fontStyle: 'italic', color: 'var(--color-on-surface)' }}>
                                      "{details.note}"
                                    </span>
                                  )}
                                  {entry.action === 'resolved' && (
                                    <span>
                                      Incident resolved
                                      {details.resolution_notes ? `: "${details.resolution_notes}"` : ''}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Add note box for active emergencies */}
                    {isActive ? (
                      <div
                        style={{
                          marginTop: '10px',
                          padding: '12px',
                          background: 'var(--color-surface-lowest, #ffffff)',
                          borderRadius: '8px',
                          border: '1px solid var(--color-outline-variant, #cbd5e1)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-slate)' }}>
                            Add Note to Audit Trail
                          </span>
                          <span style={{ fontSize: '11px', color: curNote.length > 500 ? 'var(--color-critical)' : 'var(--color-outline)' }}>
                            {curNote.length} / 500
                          </span>
                        </div>

                        {curNoteError && (
                          <div style={{ color: 'var(--color-critical)', fontSize: '12px', marginBottom: '6px' }}>
                            {curNoteError}
                          </div>
                        )}

                        <textarea
                          rows={2}
                          style={{
                            ...styles.input,
                            width: '100%',
                            boxSizing: 'border-box',
                            resize: 'vertical',
                            fontSize: '12.5px',
                            marginBottom: '8px',
                          }}
                          placeholder="Log operational update or dispatch note (max 500 characters)"
                          value={curNote}
                          maxLength={500}
                          onChange={(e) =>
                            setNoteInputs((prev) => ({ ...prev, [em.id]: e.target.value }))
                          }
                        />

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => handleAddNote(em.id)}
                            disabled={isNoteSubmitting || !curNote.trim()}
                            className="btn-primary-aero"
                            style={{ padding: '6px 14px', fontSize: '12px' }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>send</span>
                            <span>{isNoteSubmitting ? 'Adding…' : 'Add Note'}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '11.5px', color: 'var(--color-outline)', fontStyle: 'italic', marginTop: '6px' }}>
                        Incident is resolved — audit trail is closed for new notes.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
