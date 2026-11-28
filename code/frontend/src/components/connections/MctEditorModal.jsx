import { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { validateMct } from '../../utils/connectionValidation.js';

/**
 * MctEditorModal
 * Admin-only modal to view and update Minimum Connection Time (MCT) for airports.
 * Allows editing one airport at a time with inline validation (15 to 240 minutes).
 */
export default function MctEditorModal({ isOpen, onClose, onSuccess }) {
  const { token, user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [airports, setAirports] = useState([]);

  // Active editing state
  const [editingAirportId, setEditingAirportId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const loadAirports = () => {
    setLoading(true);
    setError(null);
    apiFetch('/airports')
      .then((data) => {
        setAirports(data.airports || []);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load airports');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!isOpen) return;
    setEditingAirportId(null);
    setEditValue('');
    setSuccessMsg(null);
    setSaveError(null);
    loadAirports();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleStartEdit = (airport) => {
    setEditingAirportId(airport.id);
    setEditValue(String(airport.min_connection_minutes || 60));
    setSaveError(null);
    setSuccessMsg(null);
  };

  const handleCancelEdit = () => {
    setEditingAirportId(null);
    setEditValue('');
    setSaveError(null);
  };

  const validation = validateMct(editValue);

  const handleSave = async (airportId) => {
    if (!validation.valid || saving) return;
    setSaving(true);
    setSaveError(null);
    setSuccessMsg(null);

    try {
      const res = await apiFetch(`/airports/${airportId}/mct`, {
        method: 'PATCH',
        token,
        body: {
          min_connection_minutes: validation.value,
        },
      });

      // Update local state
      setAirports((prev) =>
        prev.map((a) => (a.id === airportId ? { ...a, min_connection_minutes: validation.value } : a))
      );

      const ap = airports.find((a) => a.id === airportId);
      setSuccessMsg(
        `Successfully updated ${ap?.code || 'airport'} MCT to ${validation.value} minutes. ${
          res.reevaluated_connections_count !== undefined
            ? `Re-evaluated ${res.reevaluated_connections_count} transit connections.`
            : ''
        }`
      );

      setEditingAirportId(null);
      setEditValue('');

      if (onSuccess) onSuccess();
    } catch (err) {
      setSaveError(err.message || 'Failed to update MCT');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        backgroundColor: 'rgba(10, 25, 47, 0.65)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mct-modal-title"
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          background: 'var(--color-surface-lowest, #ffffff)',
          borderRadius: 'var(--radius-lg, 20px)',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          boxShadow: 'var(--shadow-elevated, 0 16px 40px rgba(6, 27, 58, 0.16))',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1.25rem 1.75rem',
            background: 'var(--color-surface-low, #f1f3ff)',
            borderBottom: '1px solid rgba(226, 232, 240, 0.9)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(0, 82, 204, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-primary, #0052cc)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                tune
              </span>
            </div>
            <div>
              <h2
                id="mct-modal-title"
                style={{
                  margin: 0,
                  fontSize: '1.2rem',
                  fontWeight: 800,
                  fontFamily: 'var(--font-display)',
                  color: 'var(--color-on-surface, #0f172a)',
                }}
              >
                Minimum Connection Time (MCT) Editor
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--color-slate, #64748b)' }}>
                Configure transit thresholds for hub concourses (admin only)
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-slate, #64748b)',
              padding: '4px',
              borderRadius: '6px',
            }}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {/* Admin restriction banner */}
          {!isAdmin && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#fef3c7',
                color: '#92400e',
                fontSize: '12.5px',
                marginBottom: '1rem',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '6px' }}>
                lock
              </span>
              MCT configuration is restricted to administrators. You have read-only access.
            </div>
          )}

          {/* Success Banner */}
          {successMsg && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#f0fdf4',
                color: '#166534',
                fontSize: '12.5px',
                fontWeight: 600,
                marginBottom: '1rem',
                border: '1px solid #bbf7d0',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '6px' }}>
                check_circle
              </span>
              {successMsg}
            </div>
          )}

          {/* Load or Save Error */}
          {(error || saveError) && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#fee2e2',
                color: '#991b1b',
                fontSize: '12.5px',
                fontWeight: 600,
                marginBottom: '1rem',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '6px' }}>
                error
              </span>
              {error || saveError}
            </div>
          )}

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
              <p style={{ fontSize: '13px' }}>Loading airport MCT standards…</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <th style={{ padding: '10px 16px' }}>Airport</th>
                    <th style={{ padding: '10px 16px' }}>City</th>
                    <th style={{ padding: '10px 16px' }}>Current MCT</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {airports.map((ap) => {
                    const isEditing = editingAirportId === ap.id;

                    return (
                      <tr key={ap.id} style={{ background: isEditing ? '#f8faff' : 'transparent' }}>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 800, color: '#0052cc', background: '#eff6ff', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>
                              {ap.code}
                            </span>
                            <span style={{ fontWeight: 600, color: '#1e293b' }}>{ap.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', color: '#64748b' }}>{ap.city || '—'}</td>
                        <td style={{ padding: '12px 16px' }}>
                          {isEditing ? (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                  type="number"
                                  min="15"
                                  max="240"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="w-24 px-2.5 py-1 text-xs rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                                  autoFocus
                                />
                                <span style={{ fontSize: '12px', color: '#64748b' }}>mins</span>
                              </div>
                              {!validation.valid && (
                                <span style={{ display: 'block', color: '#b91c1c', fontSize: '11px', marginTop: '4px' }}>
                                  {validation.error}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ fontWeight: 700, color: '#0f172a' }}>
                              {ap.min_connection_minutes || 60} mins
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          {isAdmin && (
                            <>
                              {isEditing ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                                  <button
                                    type="button"
                                    onClick={() => handleSave(ap.id)}
                                    disabled={!validation.valid || saving}
                                    style={{
                                      padding: '5px 12px',
                                      fontSize: '12px',
                                      borderRadius: '6px',
                                      background: '#0052cc',
                                      color: '#ffffff',
                                      border: 'none',
                                      cursor: !validation.valid || saving ? 'not-allowed' : 'pointer',
                                      opacity: !validation.valid || saving ? 0.6 : 1,
                                      fontWeight: 700,
                                    }}
                                  >
                                    {saving ? 'Saving…' : 'Save'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    disabled={saving}
                                    style={{
                                      padding: '5px 10px',
                                      fontSize: '12px',
                                      borderRadius: '6px',
                                      background: '#f1f5f9',
                                      color: '#475569',
                                      border: '1px solid #cbd5e1',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(ap)}
                                  disabled={editingAirportId !== null}
                                  style={{
                                    padding: '4px 10px',
                                    fontSize: '12px',
                                    borderRadius: '6px',
                                    background: '#f8fafc',
                                    color: '#0052cc',
                                    border: '1px solid #cbd5e1',
                                    cursor: editingAirportId !== null ? 'not-allowed' : 'pointer',
                                    fontWeight: 600,
                                  }}
                                >
                                  Edit
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '1rem 1.75rem',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary-aero"
            style={{ padding: '8px 18px', fontSize: '13px' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
