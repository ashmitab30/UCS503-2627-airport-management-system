import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { apiFetch } from '../../api/client.js';
import AirportSelect from '../../components/common/AirportSelect.jsx';
import { styles, colors } from '../../styles.js';
import {
  FACILITY_TYPES,
  FACILITY_STATUSES,
  FACILITY_TYPE_CONFIG,
  getFacilityTypeMeta,
  getFacilityStatusBadgeStyle,
  validateFacilityForm,
} from '../../utils/facilitiesHelpers.js';

export default function AdminFacilities() {
  const { token, user } = useAuth();
  const { socket } = useSocket();

  // Reference data
  const [airports, setAirports] = useState([]);

  // Filters state
  const [selectedAirportId, setSelectedAirportId] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Data state
  const [facilities, setFacilities] = useState([]);
  const [totalFacilities, setTotalFacilities] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // User action feedback
  const [actionSuccess, setActionSuccess] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Add / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFacility, setEditingFacility] = useState(null); // null = Add, object = Edit
  const [formData, setFormData] = useState({
    airport_id: '',
    name: '',
    type: 'lounge',
    location_terminal: '',
    location_gate_proximity: '',
    status: 'open',
  });
  const [formErrors, setFormErrors] = useState({});
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [modalError, setModalError] = useState(null);

  // Delete Confirmation Modal state
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Load airports on mount
  useEffect(() => {
    let isMounted = true;
    apiFetch('/airports', { token })
      .then((data) => {
        if (!isMounted) return;
        const list = data.airports || [];
        setAirports(list);
      })
      .catch((err) => console.warn('Could not load airports:', err.message));
    return () => {
      isMounted = false;
    };
  }, [token]);

  // Load facilities
  const loadFacilities = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedAirportId) params.set('airport_id', selectedAirportId);
      if (selectedType && selectedType !== 'all') params.set('type', selectedType);
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      params.set('limit', '200');

      const data = await apiFetch(`/facilities?${params.toString()}`, { token });
      setFacilities(data.facilities || []);
      setTotalFacilities(data.total || (data.facilities ? data.facilities.length : 0));
    } catch (err) {
      setError(err.message || 'Could not load facilities');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFacilities();
  }, [selectedAirportId, selectedType, statusFilter, searchQuery, token]);

  // Socket updates
  useEffect(() => {
    if (!socket) return;

    function handleFacilityChanged() {
      loadFacilities();
    }

    socket.on('facility:created', handleFacilityChanged);
    socket.on('facility:updated', handleFacilityChanged);
    socket.on('facility:status_updated', handleFacilityChanged);
    socket.on('facility:deleted', handleFacilityChanged);

    return () => {
      socket.off('facility:created', handleFacilityChanged);
      socket.off('facility:updated', handleFacilityChanged);
      socket.off('facility:status_updated', handleFacilityChanged);
      socket.off('facility:deleted', handleFacilityChanged);
    };
  }, [socket, selectedAirportId, selectedType, statusFilter, searchQuery]);

  // Open Add Modal
  function handleOpenAdd() {
    setEditingFacility(null);
    setFormData({
      airport_id: selectedAirportId || (airports.length > 0 ? String(airports[0].id) : ''),
      name: '',
      type: 'lounge',
      location_terminal: '',
      location_gate_proximity: '',
      status: 'open',
    });
    setFormErrors({});
    setModalError(null);
    setIsModalOpen(true);
  }

  // Open Edit Modal
  function handleOpenEdit(facility) {
    setEditingFacility(facility);
    setFormData({
      airport_id: String(facility.airport_id),
      name: facility.name || '',
      type: facility.type || 'lounge',
      location_terminal: facility.location_terminal || '',
      location_gate_proximity: facility.location_gate_proximity || '',
      status: facility.status || 'open',
    });
    setFormErrors({});
    setModalError(null);
    setIsModalOpen(true);
  }

  // Submit Add or Edit Form
  async function handleModalSubmit(e) {
    e.preventDefault();
    setModalError(null);

    const validation = validateFacilityForm(formData);
    if (!validation.isValid) {
      setFormErrors(validation.errors);
      return;
    }
    setFormErrors({});
    setModalSubmitting(true);

    try {
      const payload = {
        airport_id: parseInt(formData.airport_id, 10),
        name: formData.name.trim(),
        type: formData.type,
        location_terminal: formData.location_terminal.trim() || null,
        location_gate_proximity: formData.location_gate_proximity.trim() || null,
        status: formData.status,
      };

      if (editingFacility) {
        await apiFetch(`/facilities/${editingFacility.id}`, {
          method: 'PATCH',
          token,
          body: payload,
        });
        setActionSuccess(`Facility "${payload.name}" updated successfully.`);
      } else {
        await apiFetch('/facilities', {
          method: 'POST',
          token,
          body: payload,
        });
        setActionSuccess(`Facility "${payload.name}" created successfully.`);
      }

      setIsModalOpen(false);
      loadFacilities();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err) {
      setModalError(err.message || 'Operation failed');
    } finally {
      setModalSubmitting(false);
    }
  }

  // Toggle Facility Status
  async function handleToggleStatus(facility) {
    setBusyId(facility.id);
    setActionError(null);
    const newStatus = facility.status === 'open' ? 'closed' : 'open';

    try {
      await apiFetch(`/facilities/${facility.id}/status`, {
        method: 'PATCH',
        token,
        body: { status: newStatus },
      });
      setActionSuccess(`Status for "${facility.name}" updated to ${newStatus.toUpperCase()}.`);
      loadFacilities();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err) {
      setActionError(err.message || 'Could not update facility status');
    } finally {
      setBusyId(null);
    }
  }

  // Confirm Delete
  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    setDeleteError(null);

    try {
      await apiFetch(`/facilities/${deleteTarget.id}`, {
        method: 'DELETE',
        token,
      });
      setActionSuccess(`Facility "${deleteTarget.name}" deleted successfully.`);
      setDeleteTarget(null);
      loadFacilities();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err) {
      setDeleteError(err.message || 'Could not delete facility');
    } finally {
      setDeleteSubmitting(false);
    }
  }

  return (
    <div>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '26px', color: 'var(--color-primary, #0284c7)' }}
            >
              storefront
            </span>
            <h1
              style={{
                fontSize: '24px',
                fontWeight: 800,
                color: 'var(--color-on-surface, #0f172a)',
                margin: 0,
                letterSpacing: '-0.02em',
                fontFamily: 'var(--font-display, sans-serif)',
              }}
            >
              Airport Facilities Directory
            </h1>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '13.5px', color: colors.muted }}>
            Manage airport lounges, food &amp; beverage outlets, retail stores, restrooms, and amenities.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="btn-primary-aero"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '9px 18px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
            add
          </span>
          <span>Add Facility</span>
        </button>
      </div>

      {/* Global Alerts */}
      {actionSuccess && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#ecfdf5',
            color: '#065f46',
            border: '1px solid #a7f3d0',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: 600,
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
            check_circle
          </span>
          <span>{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#fef2f2',
            color: '#b91c1c',
            border: '1px solid #fecaca',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: 600,
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
            error
          </span>
          <span>{actionError}</span>
        </div>
      )}

      {/* Filter Toolbar */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          padding: '18px 20px',
          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '14px',
            alignItems: 'flex-end',
          }}
        >
          {/* Airport Filter */}
          <div>
            <AirportSelect
              valueKey="id"
              value={selectedAirportId}
              onChange={(val) => setSelectedAirportId(val || '')}
              label="Filter by Airport"
              placeholder="All Airports"
              airports={airports}
              clearable={true}
            />
          </div>

          {/* Category / Type Filter */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: colors.slate,
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Category
            </label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                backgroundColor: '#ffffff',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            >
              <option value="all">All Categories</option>
              {FACILITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FACILITY_TYPE_CONFIG[t]?.label || t}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: colors.slate,
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                backgroundColor: '#ffffff',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          {/* Search Query */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: colors.slate,
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Search
            </label>
            <div style={{ position: 'relative' }}>
              <span
                className="material-symbols-outlined"
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                  fontSize: '18px',
                }}
              >
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search facility name..."
                style={{
                  width: '100%',
                  padding: '9px 10px 9px 34px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Facilities Table Card */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b' }}>
            Registered Facilities ({facilities.length})
          </div>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{
                background: 'none',
                border: 'none',
                color: '#0284c7',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Clear search filter
            </button>
          )}
        </div>

        {loading && (
          <div style={{ padding: '48px 0', textAlign: 'center', color: '#64748b' }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}
            >
              progress_activity
            </span>
            <div style={{ marginTop: '8px', fontSize: '13px' }}>Loading directory...</div>
          </div>
        )}

        {error && (
          <div style={{ padding: '24px', textAlign: 'center', color: '#dc2626', fontSize: '13.5px' }}>
            {error}
          </div>
        )}

        {!loading && !error && facilities.length === 0 && (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '40px', color: '#cbd5e1' }}>
              storefront
            </span>
            <div style={{ fontWeight: 700, fontSize: '15px', color: '#334155', marginTop: '8px' }}>
              No facilities found
            </div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>
              No facilities matched your filters. Click "Add Facility" above to register one.
            </div>
          </div>
        )}

        {!loading && !error && facilities.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                  <th style={{ padding: '12px 18px', fontWeight: 700 }}>Facility Name</th>
                  <th style={{ padding: '12px 18px', fontWeight: 700 }}>Airport</th>
                  <th style={{ padding: '12px 18px', fontWeight: 700 }}>Terminal &amp; Location</th>
                  <th style={{ padding: '12px 18px', fontWeight: 700 }}>Category</th>
                  <th style={{ padding: '12px 18px', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '12px 18px', fontWeight: 700, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ divideY: '1px solid #f1f5f9' }}>
                {facilities.map((f) => {
                  const meta = getFacilityTypeMeta(f.type);
                  const statusStyle = getFacilityStatusBadgeStyle(f.status);
                  const isOpen = f.status === 'open';

                  return (
                    <tr
                      key={f.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        transition: 'background-color 0.15s ease',
                      }}
                    >
                      {/* Name & Icon */}
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '8px',
                              backgroundColor: meta.bgColor,
                              color: meta.color,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                              {meta.icon}
                            </span>
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{f.name}</div>
                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>ID: {f.id}</div>
                          </div>
                        </div>
                      </td>

                      {/* Airport */}
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: '#e0f2fe',
                              color: '#0369a1',
                              fontWeight: 800,
                              fontSize: '11.5px',
                            }}
                          >
                            {f.airport_code}
                          </span>
                          <span style={{ color: '#475569', fontSize: '12.5px' }}>{f.airport_city}</span>
                        </div>
                      </td>

                      {/* Terminal & Location */}
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ fontWeight: 600, color: '#334155' }}>
                          {f.location_terminal || 'Main Terminal'}
                        </div>
                        {f.location_gate_proximity && (
                          <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                            {f.location_gate_proximity}
                          </div>
                        )}
                      </td>

                      {/* Category */}
                      <td style={{ padding: '14px 18px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            backgroundColor: meta.bgColor,
                            color: meta.color,
                          }}
                        >
                          {meta.label}
                        </span>
                      </td>

                      {/* Status & Quick Toggle */}
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 8px',
                              borderRadius: '999px',
                              fontSize: '11px',
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              ...statusStyle,
                            }}
                          >
                            <span
                              style={{
                                width: '5px',
                                height: '5px',
                                borderRadius: '50%',
                                backgroundColor: isOpen ? '#10b981' : '#ef4444',
                              }}
                            />
                            {f.status}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleToggleStatus(f)}
                            disabled={busyId === f.id}
                            style={{
                              background: 'none',
                              border: '1px solid #cbd5e1',
                              borderRadius: '6px',
                              padding: '2px 6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#475569',
                              cursor: 'pointer',
                              backgroundColor: '#f8fafc',
                            }}
                            title={`Click to mark as ${isOpen ? 'closed' : 'open'}`}
                          >
                            {busyId === f.id ? '...' : isOpen ? 'Close' : 'Open'}
                          </button>
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(f)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              color: '#334155',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                            title="Edit facility details"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                              edit
                            </span>
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeleteTarget(f)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid #fecaca',
                              backgroundColor: '#fff5f5',
                              color: '#dc2626',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                            title="Delete facility"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                              delete
                            </span>
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ================= ADD / EDIT MODAL ================= */}
      {isModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '560px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '18px',
                borderBottom: '1px solid #f1f5f9',
                paddingBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: '22px', color: 'var(--color-primary, #0284c7)' }}
                >
                  {editingFacility ? 'edit' : 'add_business'}
                </span>
                <h2 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                  {editingFacility ? 'Edit Facility' : 'Add New Airport Facility'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="btn-glass"
                style={{ padding: '4px 8px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: '#fef2f2',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                {modalError}
              </div>
            )}

            <form onSubmit={handleModalSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Airport Selector */}
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: '#334155',
                      marginBottom: '4px',
                    }}
                  >
                    Airport *
                  </label>
                  <select
                    value={formData.airport_id}
                    onChange={(e) => setFormData({ ...formData, airport_id: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: formErrors.airport_id ? '1px solid #ef4444' : '1px solid #cbd5e1',
                      fontSize: '13.5px',
                      backgroundColor: '#ffffff',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">-- Select Airport --</option>
                    {airports.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.city} ({a.name})
                      </option>
                    ))}
                  </select>
                  {formErrors.airport_id && (
                    <div style={{ color: '#ef4444', fontSize: '11.5px', marginTop: '4px' }}>
                      {formErrors.airport_id}
                    </div>
                  )}
                </div>

                {/* Name */}
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: '#334155',
                      marginBottom: '4px',
                    }}
                  >
                    Facility Name * (2–80 characters)
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Encalm Lounge or Starbucks Coffee"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: formErrors.name ? '1px solid #ef4444' : '1px solid #cbd5e1',
                      fontSize: '13.5px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  {formErrors.name && (
                    <div style={{ color: '#ef4444', fontSize: '11.5px', marginTop: '4px' }}>
                      {formErrors.name}
                    </div>
                  )}
                </div>

                {/* Type & Status Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#334155',
                        marginBottom: '4px',
                      }}
                    >
                      Facility Category *
                    </label>
                    <select
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: formErrors.type ? '1px solid #ef4444' : '1px solid #cbd5e1',
                        fontSize: '13.5px',
                        backgroundColor: '#ffffff',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    >
                      {FACILITY_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {FACILITY_TYPE_CONFIG[t]?.label || t}
                        </option>
                      ))}
                    </select>
                    {formErrors.type && (
                      <div style={{ color: '#ef4444', fontSize: '11.5px', marginTop: '4px' }}>
                        {formErrors.type}
                      </div>
                    )}
                  </div>

                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#334155',
                        marginBottom: '4px',
                      }}
                    >
                      Operational Status *
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        fontSize: '13.5px',
                        backgroundColor: '#ffffff',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    >
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                </div>

                {/* Terminal & Proximity Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#334155',
                        marginBottom: '4px',
                      }}
                    >
                      Terminal Location
                    </label>
                    <input
                      type="text"
                      value={formData.location_terminal}
                      onChange={(e) => setFormData({ ...formData, location_terminal: e.target.value })}
                      placeholder="e.g. Terminal 3"
                      maxLength={80}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: formErrors.location_terminal ? '1px solid #ef4444' : '1px solid #cbd5e1',
                        fontSize: '13.5px',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    {formErrors.location_terminal && (
                      <div style={{ color: '#ef4444', fontSize: '11.5px', marginTop: '4px' }}>
                        {formErrors.location_terminal}
                      </div>
                    )}
                  </div>

                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#334155',
                        marginBottom: '4px',
                      }}
                    >
                      Gate Proximity
                    </label>
                    <input
                      type="text"
                      value={formData.location_gate_proximity}
                      onChange={(e) => setFormData({ ...formData, location_gate_proximity: e.target.value })}
                      placeholder="e.g. Near Gate 27"
                      maxLength={80}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: formErrors.location_gate_proximity ? '1px solid #ef4444' : '1px solid #cbd5e1',
                        fontSize: '13.5px',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    {formErrors.location_gate_proximity && (
                      <div style={{ color: '#ef4444', fontSize: '11.5px', marginTop: '4px' }}>
                        {formErrors.location_gate_proximity}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Modal Buttons */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '10px',
                  marginTop: '24px',
                  paddingTop: '16px',
                  borderTop: '1px solid #f1f5f9',
                }}
              >
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={modalSubmitting}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSubmitting}
                  className="btn-primary-aero"
                  style={{
                    padding: '8px 20px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {modalSubmitting ? 'Saving...' : editingFacility ? 'Save Changes' : 'Create Facility'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= DELETE CONFIRMATION MODAL ================= */}
      {deleteTarget && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: '#fee2e2',
                  color: '#dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>
                  warning
                </span>
              </div>
              <h2 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                Delete Facility
              </h2>
            </div>

            <p style={{ fontSize: '13.5px', color: '#475569', lineHeight: '1.5', margin: '0 0 16px 0' }}>
              Are you sure you want to delete <strong>{deleteTarget.name}</strong> ({deleteTarget.airport_code})?
              This action cannot be undone.
            </p>

            {deleteError && (
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: '#fef2f2',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  fontSize: '12.5px',
                  marginBottom: '16px',
                }}
              >
                {deleteError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteSubmitting}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#475569',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleteSubmitting}
                className="btn-destructive-aero"
                style={{
                  padding: '8px 18px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  backgroundColor: '#dc2626',
                }}
              >
                {deleteSubmitting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
