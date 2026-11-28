import { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { styles } from '../../styles.js';
import { formatDateTime } from '../../utils/format.js';

const TABS = [
  { id: 'checkpoints_screening', label: 'Checkpoints & Screening', icon: 'security' },
  { id: 'incidents', label: 'Incidents & Alerts', icon: 'warning' },
  { id: 'restricted_zones', label: 'Restricted Zones', icon: 'lock' },
];

export const INCIDENT_TYPES = [
  { value: 'unattended_baggage', label: 'Unattended Baggage' },
  { value: 'unauthorized_access', label: 'Unauthorized Access' },
  { value: 'suspicious_behavior', label: 'Suspicious Behavior' },
  { value: 'theft', label: 'Theft / Property Loss' },
  { value: 'altercation', label: 'Altercation / Disturbance' },
  { value: 'equipment_tamper', label: 'Equipment Tamper / Bypass' },
  { value: 'other', label: 'Other Incident' },
];

export function getCheckpointStatusMeta(status) {
  if (status === 'delayed') {
    return { pillClass: 'status-pill-amber', dotColor: 'amber', label: 'DELAYED' };
  }
  if (status === 'closed') {
    return { pillClass: 'status-pill-red', dotColor: 'red', label: 'CLOSED' };
  }
  return { pillClass: 'status-pill-green', dotColor: 'green', label: 'OPEN' };
}

export function getSeverityBadgeMeta(severity) {
  switch (severity) {
    case 'critical':
      return { pillClass: 'status-pill-red', label: 'CRITICAL', color: '#b91c1c', bg: '#fee2e2' };
    case 'high':
      return { pillClass: 'status-pill-amber', label: 'HIGH', color: '#c2410c', bg: '#ffedd5' };
    case 'medium':
      return { pillClass: 'status-pill-amber', label: 'MEDIUM', color: '#b45309', bg: '#fef3c7' };
    case 'low':
    default:
      return { pillClass: 'status-pill-blue', label: 'LOW', color: '#1d4ed8', bg: '#dbeafe' };
  }
}

export function getIncidentStatusMeta(status) {
  switch (status) {
    case 'closed':
      return { pillClass: 'status-pill-green', label: 'CLOSED', color: '#15803d', bg: '#dcfce7' };
    case 'investigating':
      return { pillClass: 'status-pill-amber', label: 'INVESTIGATING', color: '#b45309', bg: '#fef3c7' };
    case 'open':
    default:
      return { pillClass: 'status-pill-red', label: 'OPEN', color: '#b91c1c', bg: '#fee2e2' };
  }
}

export function canAdvanceStatus(currentStatus, targetStatus) {
  if (currentStatus === 'open' && targetStatus === 'investigating') return true;
  if (currentStatus === 'investigating' && targetStatus === 'closed') return true;
  return false;
}

export function validateIncidentFormInput({ location, type, severity, description }) {
  if (!location || !location.trim()) {
    return { valid: false, error: 'Location is strictly required' };
  }
  if (!type) {
    return { valid: false, error: 'Incident type is required' };
  }
  if (!severity) {
    return { valid: false, error: 'Severity rating is required' };
  }
  if (description && description.length > 1000) {
    return { valid: false, error: 'Description must not exceed 1000 characters' };
  }
  return { valid: true, error: null };
}

export function validateScreeningFormInput({ checkpointId, bookingRef, result, notes }) {
  if (!checkpointId) {
    return { valid: false, error: 'Please select a checkpoint' };
  }
  if (!bookingRef || !bookingRef.trim()) {
    return { valid: false, error: 'Please enter a booking reference' };
  }
  if (result !== 'cleared' && (!notes || !notes.trim())) {
    return { valid: false, error: 'Notes are strictly required when result is Flagged or Secondary Screening' };
  }
  return { valid: true, error: null };
}

export function validateZoneAccessFormInput({ zone, employee }) {
  if (!zone || !zone.trim()) {
    return { valid: false, error: 'Please select a restricted zone' };
  }
  if (!employee || !employee.trim()) {
    return { valid: false, error: 'Please provide employee ID or email' };
  }
  return { valid: true, error: null };
}

export default function SecurityConsole() {
  const { user, token } = useAuth();
  const { socket } = useSocket();
  const isOpsOrAdmin = ['admin', 'ops_manager'].includes(user?.role);

  const [activeTab, setActiveTab] = useState('checkpoints_screening');

  // Incident Summary Header telemetry
  const [incidentSummary, setIncidentSummary] = useState({
    total_open: 0,
    open_critical: 0,
    open_high: 0,
    open_medium: 0,
    open_low: 0,
  });

  // ---------------------------------------------------------------------------
  // Checkpoints State (Task 14)
  // ---------------------------------------------------------------------------
  const [checkpoints, setCheckpoints] = useState([]);
  const [loadingCheckpoints, setLoadingCheckpoints] = useState(true);
  const [checkpointFilterAirport, setCheckpointFilterAirport] = useState('');

  // Status Change Dialog State
  const [statusDialogCp, setStatusDialogCp] = useState(null);
  const [newStatus, setNewStatus] = useState('open');
  const [statusReason, setStatusReason] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState(null);

  // Add Checkpoint Dialog State (Admin/Ops only)
  const [addCpOpen, setAddCpOpen] = useState(false);
  const [newCpAirport, setNewCpAirport] = useState('DEL');
  const [newCpName, setNewCpName] = useState('');
  const [newCpLocation, setNewCpLocation] = useState('');
  const [addingCp, setAddingCp] = useState(false);
  const [addCpError, setAddCpError] = useState(null);

  // Record Screening Form State
  const [screenCpId, setScreenCpId] = useState('');
  const [screenRef, setScreenRef] = useState('');
  const [screenResult, setScreenResult] = useState('cleared');
  const [screenNotes, setScreenNotes] = useState('');
  const [screenSubmitting, setScreenSubmitting] = useState(false);
  const [screenError, setScreenError] = useState(null);
  const [screenSuccess, setScreenSuccess] = useState(null);

  // Booking Lookup Preview State
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupBooking, setLookupBooking] = useState(null);
  const [lookupError, setLookupError] = useState(null);
  const lookupTimeoutRef = useRef(null);

  // Recent Screenings State
  const [screenings, setScreenings] = useState([]);
  const [screeningsTotal, setScreeningsTotal] = useState(0);
  const [loadingScreenings, setLoadingScreenings] = useState(true);
  const [filterResult, setFilterResult] = useState('');
  const [filterCpId, setFilterCpId] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [pageOffset, setPageOffset] = useState(0);
  const pageSize = 15;

  // ---------------------------------------------------------------------------
  // Incidents State (Task 15 Part A)
  // ---------------------------------------------------------------------------
  const [incidents, setIncidents] = useState([]);
  const [incidentsTotal, setIncidentsTotal] = useState(0);
  const [loadingIncidents, setLoadingIncidents] = useState(true);
  const [incFilterStatus, setIncFilterStatus] = useState('all');
  const [incFilterSeverity, setIncFilterSeverity] = useState('all');
  const [incFilterType, setIncFilterType] = useState('all');
  const [incFilterSearch, setIncFilterSearch] = useState('');
  const [incOffset, setIncOffset] = useState(0);
  const incPageSize = 10;

  // Report Incident Modal State
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [newIncLocation, setNewIncLocation] = useState('');
  const [newIncType, setNewIncType] = useState('unattended_baggage');
  const [newIncSeverity, setNewIncSeverity] = useState('medium');
  const [newIncDesc, setNewIncDesc] = useState('');
  const [submittingIncident, setSubmittingIncident] = useState(false);
  const [incidentFormError, setIncidentFormError] = useState(null);
  const [incidentFormSuccess, setIncidentFormSuccess] = useState(null);

  // Incident Details Modal / Drawer State
  const [activeIncidentId, setActiveIncidentId] = useState(null);
  const [activeIncident, setActiveIncident] = useState(null);
  const [loadingActiveIncident, setLoadingActiveIncident] = useState(false);
  const [newTimelineNote, setNewTimelineNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [noteError, setNoteError] = useState(null);

  // Close Incident Dialog State
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeResolutionNotes, setCloseResolutionNotes] = useState('');
  const [closingIncident, setClosingIncident] = useState(false);
  const [closeError, setCloseError] = useState(null);

  // ---------------------------------------------------------------------------
  // Restricted Zones State (Task 15 Part B)
  // ---------------------------------------------------------------------------
  const [zones, setZones] = useState([]);
  const [loadingZones, setLoadingZones] = useState(true);

  // Check Access Form State
  const [checkZoneCode, setCheckZoneCode] = useState('');
  const [checkEmployee, setCheckEmployee] = useState('');
  const [verifyingAccess, setVerifyingAccess] = useState(false);
  const [accessResult, setAccessResult] = useState(null);
  const [accessFormError, setAccessFormError] = useState(null);

  // Zone Access Log State
  const [zoneLogs, setZoneLogs] = useState([]);
  const [zoneLogsTotal, setZoneLogsTotal] = useState(0);
  const [loadingZoneLogs, setLoadingZoneLogs] = useState(true);
  const [logFilterZone, setLogFilterZone] = useState('all');
  const [logFilterDecision, setLogFilterDecision] = useState('all');
  const [logOffset, setLogOffset] = useState(0);
  const logPageSize = 12;

  // ---------------------------------------------------------------------------
  // Data Loaders
  // ---------------------------------------------------------------------------

  // 1. Checkpoint Loader
  const loadCheckpoints = useCallback(async () => {
    try {
      setLoadingCheckpoints(true);
      const query = checkpointFilterAirport ? `?airport=${checkpointFilterAirport}` : '';
      const data = await apiFetch(`/security/checkpoints${query}`, { token });
      setCheckpoints(data.checkpoints || []);
    } catch (err) {
      console.error('Failed to load checkpoints:', err);
    } finally {
      setLoadingCheckpoints(false);
    }
  }, [token, checkpointFilterAirport]);

  // 2. Screenings Loader
  const loadScreenings = useCallback(async () => {
    try {
      setLoadingScreenings(true);
      const params = new URLSearchParams({
        limit: pageSize,
        offset: pageOffset,
      });
      if (filterResult) params.append('result', filterResult);
      if (filterCpId) params.append('checkpoint_id', filterCpId);
      if (filterSearch.trim()) params.append('search', filterSearch.trim());

      const data = await apiFetch(`/security/screenings?${params.toString()}`, { token });
      setScreenings(data.screenings || []);
      setScreeningsTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load screenings:', err);
    } finally {
      setLoadingScreenings(false);
    }
  }, [token, filterResult, filterCpId, filterSearch, pageOffset]);

  // 3. Incident Summary Loader
  const loadIncidentSummary = useCallback(async () => {
    try {
      const data = await apiFetch('/security/incidents/summary', { token });
      if (data.summary) {
        setIncidentSummary(data.summary);
      }
    } catch (err) {
      console.error('Failed to load incident summary:', err);
    }
  }, [token]);

  // 4. Incidents List Loader
  const loadIncidents = useCallback(async () => {
    try {
      setLoadingIncidents(true);
      const params = new URLSearchParams({
        limit: incPageSize,
        offset: incOffset,
      });
      if (incFilterStatus && incFilterStatus !== 'all') params.append('status', incFilterStatus);
      if (incFilterSeverity && incFilterSeverity !== 'all') params.append('severity', incFilterSeverity);
      if (incFilterType && incFilterType !== 'all') params.append('type', incFilterType);
      if (incFilterSearch.trim()) params.append('search', incFilterSearch.trim());

      const data = await apiFetch(`/security/incidents?${params.toString()}`, { token });
      setIncidents(data.incidents || []);
      setIncidentsTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load incidents:', err);
    } finally {
      setLoadingIncidents(false);
    }
  }, [token, incFilterStatus, incFilterSeverity, incFilterType, incFilterSearch, incOffset]);

  // 5. Active Incident Details Loader
  const loadActiveIncident = useCallback(async (id) => {
    if (!id) return;
    try {
      setLoadingActiveIncident(true);
      const data = await apiFetch(`/security/incidents/${id}`, { token });
      setActiveIncident(data.incident || null);
    } catch (err) {
      console.error('Failed to load incident details:', err);
    } finally {
      setLoadingActiveIncident(false);
    }
  }, [token]);

  // 6. Restricted Zones Loader
  const loadZones = useCallback(async () => {
    try {
      setLoadingZones(true);
      const data = await apiFetch('/security/zones', { token });
      const zoneList = data.zones || [];
      setZones(zoneList);
      if (zoneList.length > 0 && !checkZoneCode) {
        setCheckZoneCode(zoneList[0].code);
      }
    } catch (err) {
      console.error('Failed to load restricted zones:', err);
    } finally {
      setLoadingZones(false);
    }
  }, [token, checkZoneCode]);

  // 7. Zone Access Logs Loader
  const loadZoneLogs = useCallback(async () => {
    try {
      setLoadingZoneLogs(true);
      const params = new URLSearchParams({
        limit: logPageSize,
        offset: logOffset,
      });
      if (logFilterZone && logFilterZone !== 'all') params.append('zone', logFilterZone);
      if (logFilterDecision && logFilterDecision !== 'all') params.append('access_granted', logFilterDecision);

      const data = await apiFetch(`/security/zone-access?${params.toString()}`, { token });
      setZoneLogs(data.logs || []);
      setZoneLogsTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load zone access logs:', err);
    } finally {
      setLoadingZoneLogs(false);
    }
  }, [token, logFilterZone, logFilterDecision, logOffset]);

  // Initial loads
  useEffect(() => {
    loadCheckpoints();
    loadIncidentSummary();
  }, [loadCheckpoints, loadIncidentSummary]);

  useEffect(() => {
    if (activeTab === 'checkpoints_screening') {
      loadScreenings();
    } else if (activeTab === 'incidents') {
      loadIncidents();
    } else if (activeTab === 'restricted_zones') {
      loadZones();
      loadZoneLogs();
    }
  }, [activeTab, loadScreenings, loadIncidents, loadZones, loadZoneLogs]);

  useEffect(() => {
    if (activeIncidentId) {
      loadActiveIncident(activeIncidentId);
    }
  }, [activeIncidentId, loadActiveIncident]);

  // ---------------------------------------------------------------------------
  // WebSockets Live Synchronization
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const onScreening = (data) => {
      if (data.screening) {
        setScreenings((prev) => [data.screening, ...prev.slice(0, pageSize - 1)]);
        setScreeningsTotal((t) => t + 1);
        loadCheckpoints();
      }
    };

    const onCpStatus = (data) => {
      if (data.checkpoint) {
        setCheckpoints((prev) =>
          prev.map((cp) => (cp.id === data.checkpoint.id ? { ...cp, ...data.checkpoint } : cp))
        );
      }
    };

    const onIncident = (data) => {
      if (data.incident) {
        setIncidents((prev) => [data.incident, ...prev.slice(0, incPageSize - 1)]);
        setIncidentsTotal((t) => t + 1);
        loadIncidentSummary();
      }
    };

    const onIncidentUpdated = (data) => {
      if (data.incident) {
        setIncidents((prev) =>
          prev.map((inc) => (inc.id === data.incident.id ? { ...inc, ...data.incident } : inc))
        );
        if (activeIncidentId === data.incident.id) {
          loadActiveIncident(activeIncidentId);
        }
      } else if (data.incidentId && activeIncidentId === data.incidentId) {
        loadActiveIncident(activeIncidentId);
      }
      loadIncidentSummary();
    };

    const onZoneDenied = () => {
      loadZoneLogs();
      loadIncidentSummary();
    };

    socket.on('security:screening', onScreening);
    socket.on('security:checkpoint_status', onCpStatus);
    socket.on('security:incident', onIncident);
    socket.on('security:incident_updated', onIncidentUpdated);
    socket.on('security:zone_denied', onZoneDenied);

    return () => {
      socket.off('security:screening', onScreening);
      socket.off('security:checkpoint_status', onCpStatus);
      socket.off('security:incident', onIncident);
      socket.off('security:incident_updated', onIncidentUpdated);
      socket.off('security:zone_denied', onZoneDenied);
    };
  }, [socket, activeIncidentId, loadCheckpoints, loadIncidentSummary, loadActiveIncident, loadZoneLogs]);

  // ---------------------------------------------------------------------------
  // Form Handlers
  // ---------------------------------------------------------------------------

  // Booking Lookup Preview handler (debounced)
  const performLookup = useCallback(async (refToLookup) => {
    const cleanRef = (refToLookup || '').trim();
    if (!cleanRef || cleanRef.length < 3) {
      setLookupBooking(null);
      setLookupError(null);
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    try {
      const data = await apiFetch(`/security/lookup-booking?ref=${encodeURIComponent(cleanRef)}`, { token });
      setLookupBooking(data.booking || null);
    } catch (err) {
      setLookupBooking(null);
      setLookupError(err.message || 'Booking not found');
    } finally {
      setLookupLoading(false);
    }
  }, [token]);

  function handleRefChange(val) {
    setScreenRef(val);
    setScreenError(null);
    setScreenSuccess(null);
    if (lookupTimeoutRef.current) clearTimeout(lookupTimeoutRef.current);
    lookupTimeoutRef.current = setTimeout(() => {
      performLookup(val);
    }, 400);
  }

  // Handle Status Update Submit (Checkpoints)
  async function handleStatusSubmit(e) {
    e.preventDefault();
    if (!statusDialogCp) return;
    setUpdatingStatus(true);
    setStatusError(null);
    try {
      await apiFetch(`/security/checkpoints/${statusDialogCp.id}/status`, {
        method: 'PATCH',
        token,
        body: {
          status: newStatus,
          status_reason: statusReason.trim() || undefined,
        },
      });
      setStatusDialogCp(null);
      setStatusReason('');
      loadCheckpoints();
    } catch (err) {
      setStatusError(err.message || 'Could not update status');
    } finally {
      setUpdatingStatus(false);
    }
  }

  // Handle Add Checkpoint Submit
  async function handleAddCheckpoint(e) {
    e.preventDefault();
    if (!newCpName.trim()) {
      setAddCpError('Checkpoint name is required');
      return;
    }
    setAddingCp(true);
    setAddCpError(null);
    try {
      const airportRes = await apiFetch(`/security/checkpoints?airport=${newCpAirport}`, { token });
      const foundAirportId = airportRes.checkpoints?.[0]?.airport_id || 1;

      await apiFetch('/security/checkpoints', {
        method: 'POST',
        token,
        body: {
          airport_id: foundAirportId,
          name: newCpName.trim(),
          location: newCpLocation.trim() || undefined,
        },
      });

      setAddCpOpen(false);
      setNewCpName('');
      setNewCpLocation('');
      loadCheckpoints();
    } catch (err) {
      setAddCpError(err.message || 'Could not add checkpoint');
    } finally {
      setAddingCp(false);
    }
  }

  // Handle Record Screening Submit
  async function handleRecordScreening(e) {
    e.preventDefault();
    setScreenError(null);
    setScreenSuccess(null);

    const validation = validateScreeningFormInput({
      checkpointId: screenCpId,
      bookingRef: screenRef,
      result: screenResult,
      notes: screenNotes,
    });
    if (!validation.valid) {
      setScreenError(validation.error);
      return;
    }

    setScreenSubmitting(true);
    try {
      const res = await apiFetch('/security/screenings', {
        method: 'POST',
        token,
        body: {
          checkpoint_id: parseInt(screenCpId, 10),
          booking_ref: screenRef.trim().toUpperCase(),
          result: screenResult,
          notes: screenNotes.trim() || undefined,
        },
      });

      setScreenSuccess(`Screening recorded: Passenger ${res.passenger?.name || ''} marked ${screenResult.toUpperCase()}`);
      setScreenRef('');
      setScreenNotes('');
      setScreenResult('cleared');
      setLookupBooking(null);
      loadScreenings();
      loadCheckpoints();
    } catch (err) {
      setScreenError(err.message || 'Could not record screening log');
    } finally {
      setScreenSubmitting(false);
    }
  }

  // Handle Report Incident Submit
  async function handleReportIncident(e) {
    e.preventDefault();
    setIncidentFormError(null);
    setIncidentFormSuccess(null);

    const validation = validateIncidentFormInput({
      location: newIncLocation,
      type: newIncType,
      severity: newIncSeverity,
      description: newIncDesc,
    });
    if (!validation.valid) {
      setIncidentFormError(validation.error);
      return;
    }

    setSubmittingIncident(true);
    try {
      const data = await apiFetch('/security/incidents', {
        method: 'POST',
        token,
        body: {
          location: newIncLocation.trim(),
          type: newIncType,
          severity: newIncSeverity,
          description: newIncDesc.trim() || undefined,
        },
      });

      setIncidentFormSuccess(`Incident #${data.incident.id} logged successfully.`);
      setNewIncLocation('');
      setNewIncDesc('');
      setNewIncType('unattended_baggage');
      setNewIncSeverity('medium');
      loadIncidents();
      loadIncidentSummary();
      setTimeout(() => {
        setReportModalOpen(false);
        setIncidentFormSuccess(null);
      }, 900);
    } catch (err) {
      setIncidentFormError(err.message || 'Could not report incident');
    } finally {
      setSubmittingIncident(false);
    }
  }

  // Handle Status Advance (open -> investigating)
  async function handleAdvanceStatus(targetStatus) {
    if (!activeIncident) return;
    try {
      await apiFetch(`/security/incidents/${activeIncident.id}/status`, {
        method: 'PATCH',
        token,
        body: { status: targetStatus },
      });
      loadActiveIncident(activeIncident.id);
      loadIncidents();
      loadIncidentSummary();
    } catch (err) {
      alert(err.message || 'Could not advance status');
    }
  }

  // Handle Close Incident Submit (investigating -> closed)
  async function handleCloseIncidentSubmit(e) {
    e.preventDefault();
    if (!activeIncident) return;
    if (!closeResolutionNotes.trim()) {
      setCloseError('Resolution notes are required to close an incident');
      return;
    }
    setClosingIncident(true);
    setCloseError(null);
    try {
      await apiFetch(`/security/incidents/${activeIncident.id}/status`, {
        method: 'PATCH',
        token,
        body: {
          status: 'closed',
          resolution_notes: closeResolutionNotes.trim(),
        },
      });
      setCloseDialogOpen(false);
      setCloseResolutionNotes('');
      loadActiveIncident(activeIncident.id);
      loadIncidents();
      loadIncidentSummary();
    } catch (err) {
      setCloseError(err.message || 'Could not close incident');
    } finally {
      setClosingIncident(false);
    }
  }

  // Handle Assign Incident (to self)
  async function handleAssignSelf() {
    if (!activeIncident) return;
    try {
      await apiFetch(`/security/incidents/${activeIncident.id}/assign`, {
        method: 'POST',
        token,
        body: { assigned_to: user.id },
      });
      loadActiveIncident(activeIncident.id);
      loadIncidents();
    } catch (err) {
      alert(err.message || 'Could not assign incident');
    }
  }

  // Handle Add Timeline Note Submit
  async function handleAddNoteSubmit(e) {
    e.preventDefault();
    if (!activeIncident) return;
    if (!newTimelineNote.trim()) {
      setNoteError('Note text is required');
      return;
    }
    setAddingNote(true);
    setNoteError(null);
    try {
      await apiFetch(`/security/incidents/${activeIncident.id}/notes`, {
        method: 'POST',
        token,
        body: { note: newTimelineNote.trim() },
      });
      setNewTimelineNote('');
      loadActiveIncident(activeIncident.id);
    } catch (err) {
      setNoteError(err.message || 'Could not add note');
    } finally {
      setAddingNote(false);
    }
  }

  // Handle Check Zone Access Submit
  async function handleCheckZoneAccess(e) {
    e.preventDefault();
    setAccessFormError(null);
    setAccessResult(null);

    const validation = validateZoneAccessFormInput({
      zone: checkZoneCode,
      employee: checkEmployee,
    });
    if (!validation.valid) {
      setAccessFormError(validation.error);
      return;
    }

    setVerifyingAccess(true);
    try {
      const data = await apiFetch('/security/zone-access', {
        method: 'POST',
        token,
        body: {
          zone: checkZoneCode,
          employee: checkEmployee.trim(),
        },
      });
      setAccessResult(data);
      loadZoneLogs();
      if (!data.access_granted) {
        loadIncidentSummary();
      }
    } catch (err) {
      setAccessFormError(err.message || 'Verification failed');
    } finally {
      setVerifyingAccess(false);
    }
  }

  const openOrDelayedCheckpoints = checkpoints.filter((cp) => cp.status !== 'closed');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Banner & Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '26px' }}>
              shield
            </span>
            <h1 style={{ ...styles.title, margin: 0 }}>Security Operations Console</h1>
          </div>
          <p style={{ ...styles.subtitle, margin: 0 }}>
            Passenger screening checkpoints, incident response management, and restricted zone clearance.
          </p>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {activeTab === 'checkpoints_screening' && isOpsOrAdmin && (
            <button
              type="button"
              onClick={() => {
                setAddCpOpen(true);
                setAddCpError(null);
              }}
              className="btn-primary-aero"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add_circle</span>
              <span>Add Checkpoint</span>
            </button>
          )}

          {activeTab === 'incidents' && (
            <button
              type="button"
              onClick={() => {
                setReportModalOpen(true);
                setIncidentFormError(null);
                setIncidentFormSuccess(null);
              }}
              className="btn-primary-aero"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#dc2626' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>report</span>
              <span>Report Incident</span>
            </button>
          )}
        </div>
      </div>

      {/* Incident Summary Header Bar (Prompt #9) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'var(--color-surface-low, #f8fafc)',
          padding: '10px 16px',
          borderRadius: '12px',
          border: '1px solid var(--color-outline-variant, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '18px' }}>
            notifications_active
          </span>
          <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
            Active Security Incidents:
          </span>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '999px',
              background: incidentSummary.total_open > 0 ? '#fee2e2' : '#e2e8f0',
              color: incidentSummary.total_open > 0 ? '#b91c1c' : '#475569',
              fontSize: '12px',
              fontWeight: 800,
            }}
          >
            {incidentSummary.total_open} Open
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#b91c1c', background: '#fee2e2', padding: '3px 8px', borderRadius: '6px' }}>
            Critical: <strong>{incidentSummary.open_critical}</strong>
          </span>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#c2410c', background: '#ffedd5', padding: '3px 8px', borderRadius: '6px' }}>
            High: <strong>{incidentSummary.open_high}</strong>
          </span>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '3px 8px', borderRadius: '6px' }}>
            Medium: <strong>{incidentSummary.open_medium}</strong>
          </span>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#1d4ed8', background: '#dbeafe', padding: '3px 8px', borderRadius: '6px' }}>
            Low: <strong>{incidentSummary.open_low}</strong>
          </span>
        </div>
      </div>

      {/* Tabs navigation */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--color-surface-variant)', paddingBottom: '8px' }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              border: 'none',
              background: activeTab === tab.id ? 'var(--color-primary)' : 'transparent',
              color: activeTab === tab.id ? '#ffffff' : 'var(--color-slate)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* =======================================================================
          TAB 1: CHECKPOINTS & SCREENING (Task 14)
          ======================================================================= */}
      {activeTab === 'checkpoints_screening' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Checkpoints Grid */}
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '22px' }}>
                  sensor_door
                </span>
                <h3 style={{ ...styles.sectionTitle, margin: 0 }}>Active Checkpoints & Live Throughput</h3>
              </div>

              {/* Airport filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--color-slate)', fontWeight: 600 }}>Filter Airport:</span>
                <select
                  style={{ ...styles.select, padding: '4px 8px', width: 'auto', fontSize: '12px' }}
                  value={checkpointFilterAirport}
                  onChange={(e) => setCheckpointFilterAirport(e.target.value)}
                >
                  <option value="">All Airports</option>
                  <option value="DEL">DEL - Delhi</option>
                  <option value="BOM">BOM - Mumbai</option>
                  <option value="BLR">BLR - Bengaluru</option>
                  <option value="MAA">MAA - Chennai</option>
                  <option value="HYD">HYD - Hyderabad</option>
                  <option value="CCU">CCU - Kolkata</option>
                  <option value="GOI">GOI - Goa</option>
                  <option value="AMD">AMD - Ahmedabad</option>
                  <option value="PNQ">PNQ - Pune</option>
                  <option value="COK">COK - Kochi</option>
                  <option value="JAI">JAI - Jaipur</option>
                </select>
              </div>
            </div>

            {loadingCheckpoints ? (
              <p style={styles.muted}>Loading checkpoint telemetry…</p>
            ) : checkpoints.length === 0 ? (
              <p style={styles.muted}>No security checkpoints found.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
                {checkpoints.map((cp) => {
                  const { pillClass, dotColor } = getCheckpointStatusMeta(cp.status);

                  return (
                    <div
                      key={cp.id}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '12px',
                        background: 'var(--color-surface-lowest, #ffffff)',
                        border: '1px solid var(--color-outline-variant, #e2e8f0)',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '12px',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                              {cp.name}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--color-slate)' }}>
                              {cp.airport_code} · {cp.location || 'Terminal Area'}
                            </div>
                          </div>

                          <span className={`status-pill ${pillClass}`} style={{ textTransform: 'uppercase', fontSize: '10px' }}>
                            <span className={`dot-indicator ${dotColor}`} />
                            {cp.status}
                          </span>
                        </div>

                        {cp.status_reason && (
                          <div style={{ fontSize: '11px', color: '#b45309', background: '#fef3c7', padding: '4px 8px', borderRadius: '4px', marginTop: '6px' }}>
                            <strong>Reason:</strong> {cp.status_reason}
                          </div>
                        )}
                      </div>

                      {/* Live stats section */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', background: 'var(--color-surface-low, #f8fafc)', padding: '8px', borderRadius: '8px', textAlign: 'center' }}>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-primary)' }}>
                            {cp.screened_today}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>
                            Today
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 800, color: cp.flagged_today > 0 ? 'var(--color-critical)' : 'var(--color-slate)' }}>
                            {cp.flagged_today}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>
                            Flagged
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-secondary)' }}>
                            {cp.screened_last_hour}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>
                            1h Rate
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setStatusDialogCp(cp);
                          setNewStatus(cp.status);
                          setStatusReason(cp.status_reason || '');
                          setStatusError(null);
                        }}
                        className="btn-glass"
                        style={{ width: '100%', padding: '6px', fontSize: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                        <span>Change Status</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Record Screening Form with Live Booking Lookup */}
          <div style={styles.card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '22px' }}>
                badge
              </span>
              <h3 style={{ ...styles.sectionTitle, margin: 0 }}>Record Screening (Passenger Verification)</h3>
            </div>

            {screenError && (
              <div style={{ ...styles.errorBanner, marginBottom: '14px' }}>
                {screenError}
              </div>
            )}
            {screenSuccess && (
              <div style={{ ...styles.successBanner, marginBottom: '14px' }}>
                {screenSuccess}
              </div>
            )}

            <form onSubmit={handleRecordScreening} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
              <label style={styles.label}>
                <span>Security Checkpoint *</span>
                <select
                  style={styles.select}
                  value={screenCpId}
                  onChange={(e) => setScreenCpId(e.target.value)}
                  required
                >
                  <option value="">Select an active checkpoint…</option>
                  {openOrDelayedCheckpoints.map((cp) => (
                    <option key={cp.id} value={cp.id}>
                      {cp.airport_code} - {cp.name} ({cp.status.toUpperCase()})
                    </option>
                  ))}
                </select>
              </label>

              <label style={styles.label}>
                <span>Booking Reference *</span>
                <input
                  style={{ ...styles.input, textTransform: 'uppercase' }}
                  placeholder="e.g. BK-IN101"
                  value={screenRef}
                  onChange={(e) => handleRefChange(e.target.value)}
                  required
                />
              </label>

              <label style={styles.label}>
                <span>Screening Result *</span>
                <select
                  style={styles.select}
                  value={screenResult}
                  onChange={(e) => setScreenResult(e.target.value)}
                >
                  <option value="cleared">CLEARED (Normal)</option>
                  <option value="flagged">FLAGGED (Item/Discrepancy)</option>
                  <option value="secondary_screening">SECONDARY SCREENING (Enhanced)</option>
                </select>
              </label>

              {/* Booking Preview Card */}
              <div style={{ gridColumn: '1 / -1' }}>
                {lookupLoading && (
                  <div style={{ fontSize: '12px', color: 'var(--color-slate)', padding: '6px 0' }}>
                    Looking up booking details…
                  </div>
                )}
                {lookupError && screenRef.trim().length >= 3 && (
                  <div style={{ fontSize: '12px', color: 'var(--color-critical)', padding: '6px 0' }}>
                    {lookupError}
                  </div>
                )}
                {lookupBooking && (
                  <div
                    style={{
                      padding: '12px 16px',
                      background: 'var(--color-surface-low, #f8fafc)',
                      borderRadius: '8px',
                      border: '1px solid var(--color-outline-variant, #cbd5e1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800 }}>
                        {lookupBooking.passenger_name} ({lookupBooking.passenger_email})
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '2px' }}>
                        Flight <strong>{lookupBooking.flight_number}</strong> ({lookupBooking.origin_code} &rarr; {lookupBooking.dest_code})
                        {lookupBooking.seat_number && <span> · Seat {lookupBooking.seat_number} ({lookupBooking.seat_class})</span>}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <span className="status-pill status-pill-blue">
                        Booking: {lookupBooking.booking_status}
                      </span>
                      <span className="status-pill status-pill-slate">
                        Flight: {lookupBooking.flight_status}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <label style={{ ...styles.label, gridColumn: '1 / -1' }}>
                <span>
                  Screening Notes {screenResult !== 'cleared' ? <strong style={{ color: 'var(--color-error)' }}>* (Required for {screenResult})</strong> : '(Optional)'}
                </span>
                <textarea
                  rows={2}
                  style={{ ...styles.input, resize: 'vertical' }}
                  placeholder={
                    screenResult !== 'cleared'
                      ? 'Describe item, prohibited object, reason for flag or secondary screening protocol…'
                      : 'Optional notes (e.g. Passenger cleared manual baggage inspection)'
                  }
                  value={screenNotes}
                  onChange={(e) => setScreenNotes(e.target.value)}
                />
              </label>

              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                <button
                  type="submit"
                  disabled={screenSubmitting}
                  className="btn-primary-aero"
                  style={{ padding: '8px 22px', fontSize: '13px' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>how_to_reg</span>
                  <span>{screenSubmitting ? 'Recording…' : 'Record Screening'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Recent Screenings Table with Live Sockets */}
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '22px' }}>
                  receipt_long
                </span>
                <h3 style={{ ...styles.sectionTitle, margin: 0 }}>Recent Security Screening Logs</h3>
                <span style={{ fontSize: '12px', color: 'var(--color-outline)' }}>
                  ({screeningsTotal} total records)
                </span>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <select
                  style={{ ...styles.select, padding: '4px 8px', fontSize: '12px', width: 'auto' }}
                  value={filterResult}
                  onChange={(e) => {
                    setFilterResult(e.target.value);
                    setPageOffset(0);
                  }}
                >
                  <option value="">All Results</option>
                  <option value="cleared">Cleared</option>
                  <option value="flagged">Flagged</option>
                  <option value="secondary_screening">Secondary Screening</option>
                </select>

                <input
                  style={{ ...styles.input, padding: '4px 8px', fontSize: '12px', width: '130px' }}
                  placeholder="Search ref/name…"
                  value={filterSearch}
                  onChange={(e) => {
                    setFilterSearch(e.target.value);
                    setPageOffset(0);
                  }}
                />
              </div>
            </div>

            {loadingScreenings ? (
              <p style={styles.muted}>Loading screening logs…</p>
            ) : screenings.length === 0 ? (
              <p style={styles.muted}>No screening records match the selected filter.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--color-outline-variant, #cbd5e1)', textAlign: 'left', color: 'var(--color-slate)' }}>
                      <th style={{ padding: '8px' }}>Timestamp</th>
                      <th style={{ padding: '8px' }}>Checkpoint</th>
                      <th style={{ padding: '8px' }}>Booking</th>
                      <th style={{ padding: '8px' }}>Passenger</th>
                      <th style={{ padding: '8px' }}>Flight</th>
                      <th style={{ padding: '8px' }}>Result</th>
                      <th style={{ padding: '8px' }}>Notes</th>
                      <th style={{ padding: '8px' }}>Officer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {screenings.map((s) => {
                      let resColor = 'status-pill-green';
                      if (s.result === 'flagged') resColor = 'status-pill-amber';
                      if (s.result === 'secondary_screening') resColor = 'status-pill-red';

                      return (
                        <tr key={s.id} style={{ borderBottom: '1px solid var(--color-outline-variant, #f1f5f9)' }}>
                          <td style={{ padding: '8px', whiteSpace: 'nowrap', fontSize: '12px' }}>
                            {formatDateTime(s.timestamp)}
                          </td>
                          <td style={{ padding: '8px' }}>
                            <strong>{s.airport_code}</strong> · {s.checkpoint_name}
                          </td>
                          <td style={{ padding: '8px', fontWeight: 700 }}>
                            {s.booking_ref || '—'}
                          </td>
                          <td style={{ padding: '8px' }}>
                            {s.passenger_name}
                          </td>
                          <td style={{ padding: '8px' }}>
                            {s.flight_number || '—'}
                          </td>
                          <td style={{ padding: '8px' }}>
                            <span className={`status-pill ${resColor}`} style={{ textTransform: 'uppercase', fontSize: '10px' }}>
                              {s.result.replace('_', ' ')}
                            </span>
                          </td>
                          <td style={{ padding: '8px', fontSize: '12px', color: 'var(--color-slate)', maxWidth: '240px' }}>
                            {s.notes || <span style={{ color: '#94a3b8' }}>—</span>}
                          </td>
                          <td style={{ padding: '8px', fontSize: '12px', color: 'var(--color-slate)' }}>
                            {s.screened_by_name || 'Staff'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-slate)' }}>
                Showing {screenings.length > 0 ? pageOffset + 1 : 0} to {Math.min(pageOffset + pageSize, screeningsTotal)} of {screeningsTotal}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn-glass"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  disabled={pageOffset === 0}
                  onClick={() => setPageOffset((prev) => Math.max(prev - pageSize, 0))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-glass"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  disabled={pageOffset + pageSize >= screeningsTotal}
                  onClick={() => setPageOffset((prev) => prev + pageSize)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =======================================================================
          TAB 2: INCIDENTS & ALERTS (Task 15 Part A)
          ======================================================================= */}
      {activeTab === 'incidents' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={styles.card}>
            {/* Header & Filter Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ color: '#b91c1c', fontSize: '24px' }}>
                  warning
                </span>
                <h3 style={{ ...styles.sectionTitle, margin: 0 }}>Security Incident Registry</h3>
                <span style={{ fontSize: '12px', color: 'var(--color-outline)' }}>
                  ({incidentsTotal} total incidents)
                </span>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  style={{ ...styles.select, padding: '5px 10px', fontSize: '12px', width: 'auto' }}
                  value={incFilterStatus}
                  onChange={(e) => {
                    setIncFilterStatus(e.target.value);
                    setIncOffset(0);
                  }}
                >
                  <option value="all">All Statuses</option>
                  <option value="open">Open</option>
                  <option value="investigating">Investigating</option>
                  <option value="closed">Closed</option>
                </select>

                <select
                  style={{ ...styles.select, padding: '5px 10px', fontSize: '12px', width: 'auto' }}
                  value={incFilterSeverity}
                  onChange={(e) => {
                    setIncFilterSeverity(e.target.value);
                    setIncOffset(0);
                  }}
                >
                  <option value="all">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>

                <select
                  style={{ ...styles.select, padding: '5px 10px', fontSize: '12px', width: 'auto' }}
                  value={incFilterType}
                  onChange={(e) => {
                    setIncFilterType(e.target.value);
                    setIncOffset(0);
                  }}
                >
                  <option value="all">All Incident Types</option>
                  {INCIDENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>

                <input
                  style={{ ...styles.input, padding: '5px 10px', fontSize: '12px', width: '160px' }}
                  placeholder="Search location/reporter…"
                  value={incFilterSearch}
                  onChange={(e) => {
                    setIncFilterSearch(e.target.value);
                    setIncOffset(0);
                  }}
                />
              </div>
            </div>

            {loadingIncidents ? (
              <p style={styles.muted}>Loading incidents log…</p>
            ) : incidents.length === 0 ? (
              <p style={styles.muted}>No security incidents found matching filter criteria.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--color-outline-variant, #cbd5e1)', textAlign: 'left', color: 'var(--color-slate)' }}>
                      <th style={{ padding: '8px' }}>ID</th>
                      <th style={{ padding: '8px' }}>Severity</th>
                      <th style={{ padding: '8px' }}>Type</th>
                      <th style={{ padding: '8px' }}>Location</th>
                      <th style={{ padding: '8px' }}>Status</th>
                      <th style={{ padding: '8px' }}>Reported By</th>
                      <th style={{ padding: '8px' }}>Assigned To</th>
                      <th style={{ padding: '8px' }}>Reported At</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incidents.map((inc) => {
                      const sevMeta = getSeverityBadgeMeta(inc.severity);
                      const statMeta = getIncidentStatusMeta(inc.status);

                      return (
                        <tr
                          key={inc.id}
                          style={{
                            borderBottom: '1px solid var(--color-outline-variant, #f1f5f9)',
                            cursor: 'pointer',
                            background: activeIncidentId === inc.id ? 'var(--color-surface-low, #f8fafc)' : 'transparent',
                          }}
                          onClick={() => setActiveIncidentId(inc.id)}
                        >
                          <td style={{ padding: '8px', fontWeight: 800 }}>
                            #{inc.id}
                          </td>
                          <td style={{ padding: '8px' }}>
                            <span style={{ fontSize: '10px', fontWeight: 800, padding: '3px 8px', borderRadius: '4px', color: sevMeta.color, background: sevMeta.bg }}>
                              {sevMeta.label}
                            </span>
                          </td>
                          <td style={{ padding: '8px', fontWeight: 700 }}>
                            {inc.type.replace('_', ' ')}
                          </td>
                          <td style={{ padding: '8px', maxWidth: '200px' }}>
                            {inc.location}
                          </td>
                          <td style={{ padding: '8px' }}>
                            <span style={{ fontSize: '10px', fontWeight: 800, padding: '3px 8px', borderRadius: '4px', color: statMeta.color, background: statMeta.bg }}>
                              {statMeta.label}
                            </span>
                          </td>
                          <td style={{ padding: '8px', fontSize: '12px', color: 'var(--color-slate)' }}>
                            {inc.reported_by_name || 'Staff'}
                          </td>
                          <td style={{ padding: '8px', fontSize: '12px', color: 'var(--color-slate)' }}>
                            {inc.assigned_to_name ? (
                              <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{inc.assigned_to_name}</span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>Unassigned</span>
                            )}
                          </td>
                          <td style={{ padding: '8px', fontSize: '12px', color: 'var(--color-slate)', whiteSpace: 'nowrap' }}>
                            {formatDateTime(inc.timestamp)}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn-glass"
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveIncidentId(inc.id);
                              }}
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-slate)' }}>
                Showing {incidents.length > 0 ? incOffset + 1 : 0} to {Math.min(incOffset + incPageSize, incidentsTotal)} of {incidentsTotal}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn-glass"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  disabled={incOffset === 0}
                  onClick={() => setIncOffset((prev) => Math.max(prev - incPageSize, 0))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-glass"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  disabled={incOffset + incPageSize >= incidentsTotal}
                  onClick={() => setIncOffset((prev) => prev + incPageSize)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =======================================================================
          TAB 3: RESTRICTED ZONES & CLEARANCE (Task 15 Part B)
          ======================================================================= */}
      {activeTab === 'restricted_zones' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Section A: Restricted Zone Catalog (Read-Only) */}
          <div style={styles.card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '24px' }}>
                lock
              </span>
              <h3 style={{ ...styles.sectionTitle, margin: 0 }}>Restricted Zones & Role Access Matrix</h3>
            </div>

            {loadingZones ? (
              <p style={styles.muted}>Loading restricted zone registry…</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px' }}>
                {zones.map((z) => (
                  <div
                    key={z.id}
                    style={{
                      padding: '14px 16px',
                      borderRadius: '12px',
                      background: 'var(--color-surface-lowest, #ffffff)',
                      border: '1px solid var(--color-outline-variant, #e2e8f0)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'monospace' }}>
                          {z.code}
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: 800, padding: '2px 6px', borderRadius: '4px', background: '#f1f5f9', color: 'var(--color-slate)' }}>
                          READ-ONLY
                        </span>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        {z.name}
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--color-slate)', margin: '4px 0 10px', lineHeight: 1.4 }}>
                        {z.description}
                      </p>
                    </div>

                    <div>
                      <div style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 800, color: 'var(--color-slate)', marginBottom: '4px' }}>
                        Authorized Roles:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {(z.allowed_roles || []).map((role) => (
                          <span
                            key={role}
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              border: '1px solid #bfdbfe',
                              textTransform: 'uppercase',
                            }}
                          >
                            {role.replace('_', ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section B: Check Zone Clearance Form */}
          <div style={styles.card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '22px' }}>
                badge
              </span>
              <h3 style={{ ...styles.sectionTitle, margin: 0 }}>Check Employee Zone Clearance</h3>
            </div>

            {accessFormError && (
              <div style={{ ...styles.errorBanner, marginBottom: '14px' }}>
                {accessFormError}
              </div>
            )}

            <form onSubmit={handleCheckZoneAccess} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
              <label style={styles.label}>
                <span>Target Restricted Zone *</span>
                <select
                  style={styles.select}
                  value={checkZoneCode}
                  onChange={(e) => setCheckZoneCode(e.target.value)}
                  required
                >
                  {zones.map((z) => (
                    <option key={z.code} value={z.code}>
                      {z.code} - {z.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={styles.label}>
                <span>Employee (Email or ID) *</span>
                <input
                  style={styles.input}
                  placeholder="e.g. staff@meridian.com or Employee ID"
                  value={checkEmployee}
                  onChange={(e) => setCheckEmployee(e.target.value)}
                  required
                />
              </label>

              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  type="submit"
                  disabled={verifyingAccess}
                  className="btn-primary-aero"
                  style={{ padding: '9px 20px', width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>verified_user</span>
                  <span>{verifyingAccess ? 'Checking Clearance…' : 'Verify Clearance'}</span>
                </button>
              </div>
            </form>

            {/* Instant Verification Result Banner */}
            {accessResult && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '16px',
                  borderRadius: '12px',
                  border: accessResult.access_granted ? '1.5px solid #86efac' : '1.5px solid #fca5a5',
                  background: accessResult.access_granted ? '#f0fdf4' : '#fef2f2',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span
                    className="material-symbols-outlined"
                    style={{ color: accessResult.access_granted ? '#16a34a' : '#dc2626', fontSize: '24px' }}
                  >
                    {accessResult.access_granted ? 'check_circle' : 'gpp_bad'}
                  </span>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: accessResult.access_granted ? '#166534' : '#991b1b' }}>
                    {accessResult.access_granted ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
                  </div>
                </div>

                <div style={{ fontSize: '13px', color: accessResult.access_granted ? '#14532d' : '#7f1d1d', lineHeight: 1.5 }}>
                  {accessResult.reason}
                </div>

                {accessResult.employee && (
                  <div style={{ fontSize: '12px', marginTop: '6px', color: 'var(--color-slate)' }}>
                    Employee: <strong>{accessResult.employee.name}</strong> ({accessResult.employee.email}) · Role: <strong>{accessResult.employee.role}</strong>
                  </div>
                )}

                {!accessResult.access_granted && accessResult.incident && (
                  <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: '6px', background: '#fee2e2', border: '1px solid #f87171', fontSize: '11px', color: '#991b1b' }}>
                    <strong>Notice:</strong> An automated incident (Incident #{accessResult.incident.id} - Unauthorized Access) was immediately logged and broadcast to Security & Ops Managers.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section C: Restricted Zone Access Logs Feed */}
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '22px' }}>
                  history_edu
                </span>
                <h3 style={{ ...styles.sectionTitle, margin: 0 }}>Restricted Zone Access Audit Log</h3>
                <span style={{ fontSize: '12px', color: 'var(--color-outline)' }}>
                  ({zoneLogsTotal} total attempts logged)
                </span>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <select
                  style={{ ...styles.select, padding: '4px 8px', fontSize: '12px', width: 'auto' }}
                  value={logFilterZone}
                  onChange={(e) => {
                    setLogFilterZone(e.target.value);
                    setLogOffset(0);
                  }}
                >
                  <option value="all">All Zones</option>
                  {zones.map((z) => (
                    <option key={z.code} value={z.code}>{z.code}</option>
                  ))}
                </select>

                <select
                  style={{ ...styles.select, padding: '4px 8px', fontSize: '12px', width: 'auto' }}
                  value={logFilterDecision}
                  onChange={(e) => {
                    setLogFilterDecision(e.target.value);
                    setLogOffset(0);
                  }}
                >
                  <option value="all">All Decisions</option>
                  <option value="granted">Granted Only</option>
                  <option value="denied">Denied Only</option>
                </select>
              </div>
            </div>

            {loadingZoneLogs ? (
              <p style={styles.muted}>Loading access logs…</p>
            ) : zoneLogs.length === 0 ? (
              <p style={styles.muted}>No zone access attempts logged for the selected filter.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--color-outline-variant, #cbd5e1)', textAlign: 'left', color: 'var(--color-slate)' }}>
                      <th style={{ padding: '8px' }}>Timestamp</th>
                      <th style={{ padding: '8px' }}>Zone</th>
                      <th style={{ padding: '8px' }}>Employee</th>
                      <th style={{ padding: '8px' }}>Role</th>
                      <th style={{ padding: '8px' }}>Clearance</th>
                      <th style={{ padding: '8px' }}>Reason</th>
                      <th style={{ padding: '8px' }}>Recorded By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zoneLogs.map((log) => (
                      <tr
                        key={log.id}
                        style={{
                          borderBottom: '1px solid var(--color-outline-variant, #f1f5f9)',
                          background: log.access_granted ? 'transparent' : 'rgba(254, 226, 226, 0.4)',
                        }}
                      >
                        <td style={{ padding: '8px', whiteSpace: 'nowrap', fontSize: '12px' }}>
                          {formatDateTime(log.timestamp)}
                        </td>
                        <td style={{ padding: '8px', fontWeight: 800 }}>
                          {log.zone}
                        </td>
                        <td style={{ padding: '8px' }}>
                          {log.employee_name} ({log.employee_email})
                        </td>
                        <td style={{ padding: '8px', fontSize: '12px', color: 'var(--color-slate)', textTransform: 'uppercase' }}>
                          {log.employee_role?.replace('_', ' ')}
                        </td>
                        <td style={{ padding: '8px' }}>
                          <span
                            className={`status-pill ${log.access_granted ? 'status-pill-green' : 'status-pill-red'}`}
                            style={{ textTransform: 'uppercase', fontSize: '10px' }}
                          >
                            {log.access_granted ? 'GRANTED' : 'DENIED'}
                          </span>
                        </td>
                        <td style={{ padding: '8px', fontSize: '12px', color: log.access_granted ? 'var(--color-slate)' : '#b91c1c', maxWidth: '280px' }}>
                          {log.reason}
                        </td>
                        <td style={{ padding: '8px', fontSize: '12px', color: 'var(--color-slate)' }}>
                          {log.recorded_by_name || 'System Gate'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-slate)' }}>
                Showing {zoneLogs.length > 0 ? logOffset + 1 : 0} to {Math.min(logOffset + logPageSize, zoneLogsTotal)} of {zoneLogsTotal}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn-glass"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  disabled={logOffset === 0}
                  onClick={() => setLogOffset((prev) => Math.max(prev - logPageSize, 0))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-glass"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  disabled={logOffset + logPageSize >= zoneLogsTotal}
                  onClick={() => setLogOffset((prev) => prev + logPageSize)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =======================================================================
          MODALS & DIALOGS
          ======================================================================= */}

      {/* 1. Status Change Dialog (Checkpoints) */}
      {statusDialogCp && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalContent, maxWidth: '440px' }}>
            <h3 style={{ ...styles.sectionTitle, marginTop: 0 }}>
              Update Checkpoint Status
            </h3>
            <p style={{ ...styles.muted, marginTop: '-6px' }}>
              {statusDialogCp.airport_code} · {statusDialogCp.name}
            </p>

            {statusError && (
              <div style={{ ...styles.errorBanner, marginBottom: '12px' }}>
                {statusError}
              </div>
            )}

            <form onSubmit={handleStatusSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={styles.label}>
                <span>New Status</span>
                <select
                  style={styles.select}
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                >
                  <option value="open">OPEN</option>
                  <option value="delayed">DELAYED</option>
                  <option value="closed">CLOSED</option>
                </select>
              </label>

              <label style={styles.label}>
                <span>Operational Reason (optional for open, recommended for delayed/closed)</span>
                <input
                  style={styles.input}
                  placeholder="e.g. Lane 2 scanner calibration or maintenance"
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                />
              </label>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn-glass"
                  disabled={updatingStatus}
                  onClick={() => setStatusDialogCp(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingStatus}
                  className="btn-primary-aero"
                >
                  {updatingStatus ? 'Updating…' : 'Update Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Add Checkpoint Dialog (Admin/Ops only) */}
      {addCpOpen && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalContent, maxWidth: '440px' }}>
            <h3 style={{ ...styles.sectionTitle, marginTop: 0 }}>
              Add Security Checkpoint Lane
            </h3>

            {addCpError && (
              <div style={{ ...styles.errorBanner, marginBottom: '12px' }}>
                {addCpError}
              </div>
            )}

            <form onSubmit={handleAddCheckpoint} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={styles.label}>
                <span>Airport</span>
                <select
                  style={styles.select}
                  value={newCpAirport}
                  onChange={(e) => setNewCpAirport(e.target.value)}
                >
                  <option value="DEL">DEL - Indira Gandhi International</option>
                  <option value="BOM">BOM - Chhatrapati Shivaji Maharaj</option>
                  <option value="BLR">BLR - Kempegowda International</option>
                  <option value="MAA">MAA - Chennai International</option>
                  <option value="HYD">HYD - Rajiv Gandhi International</option>
                  <option value="CCU">CCU - Netaji Subhash Chandra Bose</option>
                </select>
              </label>

              <label style={styles.label}>
                <span>Checkpoint Name *</span>
                <input
                  style={styles.input}
                  placeholder="e.g. Terminal 3 FastTrack Lane 1"
                  value={newCpName}
                  onChange={(e) => setNewCpName(e.target.value)}
                  required
                />
              </label>

              <label style={styles.label}>
                <span>Terminal Location</span>
                <input
                  style={styles.input}
                  placeholder="e.g. Concourse B, Gate 15-20 Pier"
                  value={newCpLocation}
                  onChange={(e) => setNewCpLocation(e.target.value)}
                />
              </label>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn-glass"
                  disabled={addingCp}
                  onClick={() => setAddCpOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingCp}
                  className="btn-primary-aero"
                >
                  {addingCp ? 'Deploying…' : 'Deploy Checkpoint'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Report Incident Modal */}
      {reportModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalContent, maxWidth: '480px' }}>
            <h3 style={{ ...styles.sectionTitle, marginTop: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-outlined" style={{ color: '#b91c1c' }}>warning</span>
              <span>Report Security Incident</span>
            </h3>

            {incidentFormError && (
              <div style={{ ...styles.errorBanner, marginBottom: '12px' }}>
                {incidentFormError}
              </div>
            )}
            {incidentFormSuccess && (
              <div style={{ ...styles.successBanner, marginBottom: '12px' }}>
                {incidentFormSuccess}
              </div>
            )}

            <form onSubmit={handleReportIncident} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={styles.label}>
                <span>Location *</span>
                <input
                  style={styles.input}
                  placeholder="e.g. Terminal 3 Pier B, Gate 14"
                  value={newIncLocation}
                  onChange={(e) => setNewIncLocation(e.target.value)}
                  required
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={styles.label}>
                  <span>Incident Type *</span>
                  <select
                    style={styles.select}
                    value={newIncType}
                    onChange={(e) => setNewIncType(e.target.value)}
                  >
                    {INCIDENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>

                <label style={styles.label}>
                  <span>Severity *</span>
                  <select
                    style={styles.select}
                    value={newIncSeverity}
                    onChange={(e) => setNewIncSeverity(e.target.value)}
                  >
                    <option value="low">LOW (Minor/Notice)</option>
                    <option value="medium">MEDIUM (Standard)</option>
                    <option value="high">HIGH (Urgent Response)</option>
                    <option value="critical">CRITICAL (Airside Breach/Threat)</option>
                  </select>
                </label>
              </div>

              <label style={styles.label}>
                <span>Description (up to 1000 characters)</span>
                <textarea
                  rows={3}
                  maxLength={1000}
                  style={{ ...styles.input, resize: 'vertical' }}
                  placeholder="Describe individual behavior, luggage marks, or situation details…"
                  value={newIncDesc}
                  onChange={(e) => setNewIncDesc(e.target.value)}
                />
              </label>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn-glass"
                  disabled={submittingIncident}
                  onClick={() => setReportModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingIncident}
                  className="btn-primary-aero"
                  style={{ backgroundColor: '#dc2626' }}
                >
                  {submittingIncident ? 'Logging…' : 'Submit Incident Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Incident Detail Drawer / Modal with Timeline */}
      {activeIncidentId && activeIncident && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalContent, maxWidth: '640px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ ...styles.sectionTitle, margin: 0 }}>
                    Incident #{activeIncident.id}
                  </h3>
                  <span style={{ fontSize: '11px', fontWeight: 800, padding: '3px 8px', borderRadius: '4px', ...getSeverityBadgeMeta(activeIncident.severity) }}>
                    {activeIncident.severity.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '11px', fontWeight: 800, padding: '3px 8px', borderRadius: '4px', ...getIncidentStatusMeta(activeIncident.status) }}>
                    {activeIncident.status.toUpperCase()}
                  </span>
                </div>
                <p style={{ ...styles.muted, margin: '4px 0 0' }}>
                  {activeIncident.location} · {activeIncident.type.replace('_', ' ')}
                </p>
              </div>

              <button
                type="button"
                className="btn-glass"
                style={{ padding: '4px 8px' }}
                onClick={() => setActiveIncidentId(null)}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
              </button>
            </div>

            {/* Description & Metadata */}
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', color: 'var(--color-on-surface)', lineHeight: 1.5 }}>
                {activeIncident.description || 'No initial description recorded.'}
              </div>
              <div style={{ display: 'flex', gap: '16px', marginTop: '10px', fontSize: '11px', color: 'var(--color-slate)' }}>
                <span>Reported by: <strong>{activeIncident.reported_by_name || 'Staff'}</strong></span>
                <span>Reported at: <strong>{formatDateTime(activeIncident.timestamp)}</strong></span>
                <span>
                  Assignee: <strong>{activeIncident.assigned_to_name || 'Unassigned'}</strong>
                </span>
              </div>
            </div>

            {/* If Closed: Display Resolution Notes */}
            {activeIncident.status === 'closed' && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '12px', borderRadius: '8px', marginBottom: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#166534', marginBottom: '4px' }}>
                  Incident Resolution Summary
                </div>
                <div style={{ fontSize: '13px', color: '#14532d' }}>
                  {activeIncident.resolution_notes || 'Resolved without specific resolution notes.'}
                </div>
                {activeIncident.closed_at && (
                  <div style={{ fontSize: '11px', color: '#15803d', marginTop: '4px' }}>
                    Closed at: {formatDateTime(activeIncident.closed_at)}
                  </div>
                )}
              </div>
            )}

            {/* Actions: Workflow Advance & Assign */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px', padding: '10px', background: '#f1f5f9', borderRadius: '8px' }}>
              {activeIncident.status === 'open' && (
                <button
                  type="button"
                  onClick={() => handleAdvanceStatus('investigating')}
                  className="btn-primary-aero"
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>search</span>
                  <span>Advance to Investigating</span>
                </button>
              )}

              {activeIncident.status === 'investigating' && (
                <button
                  type="button"
                  onClick={() => {
                    setCloseDialogOpen(true);
                    setCloseError(null);
                    setCloseResolutionNotes('');
                  }}
                  className="btn-primary-aero"
                  style={{ fontSize: '12px', padding: '6px 14px', backgroundColor: '#16a34a' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span>
                  <span>Close Incident</span>
                </button>
              )}

              {(!activeIncident.assigned_to || activeIncident.assigned_to !== user.id) && (
                <button
                  type="button"
                  onClick={handleAssignSelf}
                  className="btn-glass"
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>person_add</span>
                  <span>Assign to Me</span>
                </button>
              )}
            </div>

            {/* Timeline Stream */}
            <h4 style={{ ...styles.sectionTitle, fontSize: '14px', marginBottom: '10px' }}>
              Incident Timeline & Activity Trail
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {(activeIncident.timeline || []).map((t) => (
                <div
                  key={t.id}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <span style={{ fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase', fontSize: '10px' }}>
                      {t.action.replace('_', ' ')} · {t.actor_name} ({t.actor_role?.replace('_', ' ')})
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--color-slate)' }}>
                      {formatDateTime(t.created_at)}
                    </span>
                  </div>
                  <div style={{ color: 'var(--color-on-surface)' }}>
                    {t.note}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Note Form */}
            {activeIncident.status !== 'closed' && (
              <form onSubmit={handleAddNoteSubmit} style={{ display: 'flex', gap: '8px' }}>
                <input
                  style={{ ...styles.input, flex: 1, fontSize: '12px' }}
                  placeholder="Add an operational note or update to the incident timeline…"
                  value={newTimelineNote}
                  onChange={(e) => setNewTimelineNote(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={addingNote}
                  className="btn-primary-aero"
                  style={{ fontSize: '12px', padding: '6px 16px', whiteSpace: 'nowrap' }}
                >
                  {addingNote ? 'Adding…' : 'Add Note'}
                </button>
              </form>
            )}
            {noteError && (
              <div style={{ ...styles.errorBanner, marginTop: '8px', fontSize: '12px' }}>
                {noteError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. Close Incident Resolution Notes Dialog */}
      {closeDialogOpen && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalContent, maxWidth: '440px' }}>
            <h3 style={{ ...styles.sectionTitle, marginTop: 0 }}>
              Close Security Incident
            </h3>
            <p style={{ ...styles.muted, marginTop: '-6px' }}>
              Closing an incident requires clear resolution notes detailing actions taken.
            </p>

            {closeError && (
              <div style={{ ...styles.errorBanner, marginBottom: '12px' }}>
                {closeError}
              </div>
            )}

            <form onSubmit={handleCloseIncidentSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={styles.label}>
                <span>Resolution Notes *</span>
                <textarea
                  rows={3}
                  style={{ ...styles.input, resize: 'vertical' }}
                  placeholder="Explain resolution (e.g. Bag returned to verified passenger; tamper switch reconnected and tested; suspect questioned by CISF)…"
                  value={closeResolutionNotes}
                  onChange={(e) => setCloseResolutionNotes(e.target.value)}
                  required
                />
              </label>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn-glass"
                  disabled={closingIncident}
                  onClick={() => setCloseDialogOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={closingIncident}
                  className="btn-primary-aero"
                  style={{ backgroundColor: '#16a34a' }}
                >
                  {closingIncident ? 'Closing…' : 'Confirm Close Incident'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
