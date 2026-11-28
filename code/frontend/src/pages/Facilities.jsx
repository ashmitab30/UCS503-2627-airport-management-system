import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { apiFetch } from '../api/client.js';
import SiteHeader from './SiteHeader.jsx';
import AirportSelect from '../components/common/AirportSelect.jsx';
import { styles, colors } from '../styles.js';
import {
  FACILITY_TYPES,
  FACILITY_TYPE_CONFIG,
  getFacilityTypeMeta,
  getFacilityStatusBadgeStyle,
  groupFacilitiesByTerminal,
} from '../utils/facilitiesHelpers.js';

export default function Facilities() {
  const { token } = useAuth();
  const { socket } = useSocket();

  const [airports, setAirports] = useState([]);
  const [selectedAirportId, setSelectedAirportId] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load airports once
  useEffect(() => {
    let isMounted = true;
    apiFetch('/airports', { token })
      .then((data) => {
        if (!isMounted) return;
        const list = data.airports || [];
        setAirports(list);
        if (list.length > 0 && !selectedAirportId) {
          setSelectedAirportId(String(list[0].id));
        }
      })
      .catch((err) => {
        console.warn('Could not load airports:', err.message);
      });
    return () => {
      isMounted = false;
    };
  }, [token]);

  // Load facilities when filters change
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
      params.set('limit', '100');

      const data = await apiFetch(`/facilities?${params.toString()}`, { token });
      setFacilities(data.facilities || []);
    } catch (err) {
      setError(err.message || 'Could not load facilities directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFacilities();
  }, [selectedAirportId, selectedType, statusFilter, searchQuery, token]);

  // Live real-time socket listeners
  useEffect(() => {
    if (!socket) return;

    function handleFacilityUpdate() {
      loadFacilities();
    }

    socket.on('facility:created', handleFacilityUpdate);
    socket.on('facility:updated', handleFacilityUpdate);
    socket.on('facility:status_updated', handleFacilityUpdate);
    socket.on('facility:deleted', handleFacilityUpdate);

    return () => {
      socket.off('facility:created', handleFacilityUpdate);
      socket.off('facility:updated', handleFacilityUpdate);
      socket.off('facility:status_updated', handleFacilityUpdate);
      socket.off('facility:deleted', handleFacilityUpdate);
    };
  }, [socket, selectedAirportId, selectedType, statusFilter, searchQuery]);

  // Group facilities by terminal
  const groupedFacilities = useMemo(() => {
    return groupFacilitiesByTerminal(facilities);
  }, [facilities]);

  const selectedAirportObj = airports.find((a) => String(a.id) === String(selectedAirportId));

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-surface, #f8fafc)' }}>
      <SiteHeader />

      <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px 24px 64px' }}>
        {/* Hero Section */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '32px', color: 'var(--color-primary, #0284c7)' }}
            >
              storefront
            </span>
            <h1
              style={{
                fontSize: '28px',
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
          <p
            style={{
              fontSize: '14px',
              color: 'var(--color-on-surface-variant, #64748b)',
              margin: 0,
            }}
          >
            Explore lounges, dining, retail, charging stations, and passenger services across all terminals.
          </p>
        </div>

        {/* Filter Controls Bar */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            border: '1px solid rgba(226, 232, 240, 0.9)',
            padding: '20px 24px',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.03)',
            marginBottom: '28px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '16px',
              alignItems: 'flex-end',
              marginBottom: '20px',
            }}
          >
            {/* Airport Selector */}
            <div>
              <AirportSelect
                valueKey="id"
                value={selectedAirportId}
                onChange={(newId) => setSelectedAirportId(newId || '')}
                label="Select Airport"
                placeholder="Search airport..."
                airports={airports}
                clearable={false}
              />
            </div>

            {/* Name Search Input */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--color-on-surface, #334155)',
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Search Facilities
              </label>
              <div style={{ position: 'relative' }}>
                <span
                  className="material-symbols-outlined"
                  style={{
                    position: 'absolute',
                    left: '12px',
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
                  placeholder="Search by name, cuisine, brand..."
                  style={{
                    width: '100%',
                    padding: '9px 36px 9px 38px',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13.5px',
                    color: '#1e293b',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '2px',
                    }}
                    title="Clear search"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                      close
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Status Quick Filter */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--color-on-surface, #334155)',
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Operational Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9.5px 12px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13.5px',
                  color: '#1e293b',
                  backgroundColor: '#ffffff',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="all">All Statuses (Open &amp; Closed)</option>
                <option value="open">Open Only</option>
                <option value="closed">Temporarily Closed</option>
              </select>
            </div>
          </div>

          {/* Type Filter Chips */}
          <div>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant, #64748b)',
                marginBottom: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Filter by Category
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setSelectedType('all')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '999px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: selectedType === 'all' ? '1px solid #0284c7' : '1px solid #e2e8f0',
                  backgroundColor: selectedType === 'all' ? '#0284c7' : '#f8fafc',
                  color: selectedType === 'all' ? '#ffffff' : '#475569',
                  transition: 'all 0.15s ease',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                  apps
                </span>
                <span>All Amenities</span>
              </button>

              {FACILITY_TYPES.map((typeKey) => {
                const meta = FACILITY_TYPE_CONFIG[typeKey];
                const isSelected = selectedType === typeKey;
                return (
                  <button
                    key={typeKey}
                    type="button"
                    onClick={() => setSelectedType(typeKey)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      borderRadius: '999px',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: isSelected ? `1px solid ${meta.color}` : '1px solid #e2e8f0',
                      backgroundColor: isSelected ? meta.color : '#f8fafc',
                      color: isSelected ? '#ffffff' : '#475569',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                      {meta.icon}
                    </span>
                    <span>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Airport banner info */}
        {selectedAirportObj && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '20px',
              padding: '0 4px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: '6px',
                  backgroundColor: '#e0f2fe',
                  color: '#0369a1',
                  fontWeight: 800,
                  fontSize: '13px',
                }}
              >
                {selectedAirportObj.code}
              </span>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#1e293b' }}>
                {selectedAirportObj.name}
              </span>
              <span style={{ fontSize: '13px', color: '#64748b' }}>• {selectedAirportObj.city}</span>
            </div>
            <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>
              {facilities.length} {facilities.length === 1 ? 'facility' : 'facilities'} found
            </div>
          </div>
        )}

        {/* Error Feedback */}
        {error && (
          <div
            style={{
              padding: '14px 18px',
              backgroundColor: '#fef2f2',
              color: '#b91c1c',
              border: '1px solid #fecaca',
              borderRadius: '12px',
              fontSize: '13.5px',
              marginBottom: '24px',
            }}
          >
            {error}
          </div>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '36px', animation: 'spin 1s linear infinite' }}
            >
              progress_activity
            </span>
            <div style={{ marginTop: '8px', fontSize: '14px', fontWeight: 600 }}>Loading facilities...</div>
          </div>
        )}

        {/* Empty State */}
        {!loading && facilities.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '64px 24px',
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              border: '1px dashed #cbd5e1',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '48px', color: '#94a3b8' }}>
              search_off
            </span>
            <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#334155', margin: '12px 0 6px' }}>
              No facilities found
            </h3>
            <p style={{ fontSize: '13.5px', color: '#64748b', maxWidth: '440px', margin: '0 auto' }}>
              No facilities match your selected airport, category, or search keywords. Try clearing search filters
              or selecting a different terminal.
            </p>
          </div>
        )}

        {/* Grouped Facility Cards */}
        {!loading && facilities.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            {Object.entries(groupedFacilities).map(([terminalName, items]) => (
              <div key={terminalName}>
                {/* Terminal Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '16px',
                    paddingBottom: '8px',
                    borderBottom: '2px solid rgba(226, 232, 240, 0.8)',
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '20px', color: 'var(--color-primary, #0284c7)' }}
                  >
                    flight_class
                  </span>
                  <h2
                    style={{
                      fontSize: '18px',
                      fontWeight: 800,
                      color: 'var(--color-on-surface, #0f172a)',
                      margin: 0,
                      fontFamily: 'var(--font-display, sans-serif)',
                    }}
                  >
                    {terminalName}
                  </h2>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '999px',
                      backgroundColor: 'rgba(2, 132, 199, 0.08)',
                      color: '#0284c7',
                    }}
                  >
                    {items.length} {items.length === 1 ? 'place' : 'places'}
                  </span>
                </div>

                {/* Cards Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                    gap: '18px',
                  }}
                >
                  {items.map((facility) => {
                    const meta = getFacilityTypeMeta(facility.type);
                    const statusStyle = getFacilityStatusBadgeStyle(facility.status);
                    const isOpen = facility.status === 'open';

                    return (
                      <div
                        key={facility.id}
                        style={{
                          backgroundColor: '#ffffff',
                          borderRadius: '14px',
                          border: '1px solid rgba(226, 232, 240, 0.9)',
                          padding: '20px',
                          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '14px',
                          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                        }}
                      >
                        <div>
                          {/* Top Row: Type Icon & Status Chip */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: '12px',
                            }}
                          >
                            <div
                              style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '10px',
                                backgroundColor: meta.bgColor,
                                color: meta.color,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>
                                {meta.icon}
                              </span>
                            </div>

                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '3px 10px',
                                borderRadius: '999px',
                                fontSize: '11px',
                                fontWeight: 800,
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                                ...statusStyle,
                              }}
                            >
                              <span
                                style={{
                                  width: '6px',
                                  height: '6px',
                                  borderRadius: '50%',
                                  backgroundColor: isOpen ? '#10b981' : '#ef4444',
                                }}
                              />
                              {facility.status}
                            </span>
                          </div>

                          {/* Facility Name & Category */}
                          <h3
                            style={{
                              fontSize: '16px',
                              fontWeight: 700,
                              color: '#0f172a',
                              margin: '0 0 6px 0',
                              lineHeight: '1.3',
                            }}
                          >
                            {facility.name}
                          </h3>

                          <span
                            style={{
                              display: 'inline-block',
                              fontSize: '11px',
                              fontWeight: 700,
                              color: meta.color,
                              textTransform: 'uppercase',
                              letterSpacing: '0.03em',
                              marginBottom: '10px',
                            }}
                          >
                            {meta.label}
                          </span>
                        </div>

                        {/* Location Details Footer */}
                        <div
                          style={{
                            paddingTop: '12px',
                            borderTop: '1px solid #f1f5f9',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            fontSize: '12.5px',
                            color: '#64748b',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: '16px', color: '#0284c7' }}
                            >
                              location_on
                            </span>
                            <span style={{ fontWeight: 600, color: '#334155' }}>
                              {facility.location_terminal || 'Main Terminal'}
                            </span>
                          </div>

                          {facility.location_gate_proximity && (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                paddingLeft: '22px',
                                color: '#64748b',
                              }}
                            >
                              <span>{facility.location_gate_proximity}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
