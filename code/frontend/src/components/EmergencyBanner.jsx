import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { apiFetch } from '../api/client.js';

export function formatTimeAgo(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  return `${diffHour}h ${remMin}m ago`;
}

export default function EmergencyBanner() {
  const { user, token } = useAuth();
  const { socket, status } = useSocket();
  const [emergencies, setEmergencies] = useState([]);
  const [acknowledgingId, setAcknowledgingId] = useState(null);
  const [ackError, setAckError] = useState(null);

  const loadActive = useCallback(async () => {
    if (!token || !user || user.role === 'passenger') return;
    try {
      const data = await apiFetch('/emergencies/active-for-me', { token });
      setEmergencies(data.emergencies || []);
    } catch {
      // Background poll failure is non-blocking
    }
  }, [token, user]);

  useEffect(() => {
    loadActive();
  }, [loadActive, status]);

  // Socket live update listeners
  useEffect(() => {
    if (!socket || !user || user.role === 'passenger') return;

    const onDeclared = (data) => {
      const alertedRoles = data.alertedRoles || [];
      if (alertedRoles.includes(user.role) || ['admin', 'ops_manager'].includes(user.role)) {
        loadActive();
      }
    };

    const onAcknowledged = (data) => {
      setEmergencies((prev) =>
        prev.map((em) => {
          if (em.id === data.emergencyId && em.recipient_role === data.role) {
            return {
              ...em,
              is_acknowledged: true,
              acknowledged_by: data.acknowledgedBy,
              acknowledged_by_name: data.acknowledgedByName || 'Staff Member',
              acknowledged_at: data.acknowledgedAt || new Date().toISOString(),
            };
          }
          return em;
        })
      );
    };

    const onResolved = (data) => {
      const resId = data.emergency?.id || data.emergencyId;
      setEmergencies((prev) => prev.filter((em) => em.id !== resId));
    };

    const onNote = () => {
      // Live reload to capture any updated notes
      loadActive();
    };

    socket.on('emergency:declared', onDeclared);
    socket.on('emergency:acknowledged', onAcknowledged);
    socket.on('emergency:resolved', onResolved);
    socket.on('emergency:note', onNote);

    return () => {
      socket.off('emergency:declared', onDeclared);
      socket.off('emergency:acknowledged', onAcknowledged);
      socket.off('emergency:resolved', onResolved);
      socket.off('emergency:note', onNote);
    };
  }, [socket, user, loadActive]);

  async function handleAcknowledge(emergencyId) {
    setAcknowledgingId(emergencyId);
    setAckError(null);
    try {
      const res = await apiFetch(`/emergencies/${emergencyId}/acknowledge`, {
        method: 'PATCH',
        token,
      });
      setEmergencies((prev) =>
        prev.map((em) => {
          if (em.id === emergencyId) {
            return {
              ...em,
              is_acknowledged: true,
              acknowledged_by: res.alert?.acknowledged_by || user.id,
              acknowledged_by_name: user.name || 'You',
              acknowledged_at: res.alert?.acknowledged_at || new Date().toISOString(),
            };
          }
          return em;
        })
      );
    } catch (err) {
      setAckError(err.message || 'Could not acknowledge emergency');
    } finally {
      setAcknowledgingId(null);
    }
  }

  if (!emergencies || emergencies.length === 0) {
    return null;
  }

  const emergencyPageUrl = ['admin', 'ops_manager'].includes(user?.role)
    ? '/admin/emergencies'
    : '/staff/emergencies';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }} data-testid="emergency-banner-container">
      {ackError && (
        <div style={{ padding: '8px 12px', background: 'var(--color-error-container)', color: 'var(--color-on-error-container)', borderRadius: '8px', fontSize: '12px' }}>
          {ackError}
        </div>
      )}
      {emergencies.map((em) => {
        const locationText = [
          em.flight_number ? `Flight ${em.flight_number}` : null,
          em.gate_code ? `Gate ${em.gate_code}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'Airport Terminal';

        return (
          <div
            key={em.id}
            data-testid={`emergency-banner-${em.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '12px 18px',
              borderRadius: '12px',
              background: 'linear-gradient(90deg, #7f1d1d 0%, #991b1b 100%)',
              color: '#ffffff',
              boxShadow: '0 4px 16px rgba(185, 28, 28, 0.35)',
              border: '1px solid rgba(254, 202, 202, 0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#fecaca', animation: 'pulse 1.5s infinite' }}>
                  warning
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    background: 'rgba(255, 255, 255, 0.2)',
                    padding: '2px 8px',
                    borderRadius: '6px',
                  }}
                >
                  {em.type} Emergency
                </span>
              </div>

              <div style={{ fontSize: '13px', fontWeight: 600 }}>
                <span>{locationText}</span>
                <span style={{ margin: '0 8px', opacity: 0.6 }}>•</span>
                <span style={{ opacity: 0.9 }}>Declared {formatTimeAgo(em.declared_at)}</span>
                {em.notes && (
                  <span style={{ marginLeft: '8px', opacity: 0.85, fontStyle: 'italic', fontSize: '12px' }}>
                    "{em.notes}"
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {em.is_acknowledged ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    background: 'rgba(16, 185, 129, 0.25)',
                    border: '1px solid rgba(52, 211, 153, 0.5)',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    color: '#a7f3d0',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span>
                  <span>
                    Acknowledged by {em.acknowledged_by_name || 'Staff'} ({formatTimeAgo(em.acknowledged_at)})
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid={`acknowledge-btn-${em.id}`}
                  disabled={acknowledgingId === em.id}
                  onClick={() => handleAcknowledge(em.id)}
                  style={{
                    background: '#fef08a',
                    color: '#713f12',
                    border: 'none',
                    fontWeight: 800,
                    fontSize: '12px',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    cursor: acknowledgingId === em.id ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check</span>
                  <span>{acknowledgingId === em.id ? 'Acknowledging…' : 'Acknowledge'}</span>
                </button>
              )}

              <Link
                to={emergencyPageUrl}
                style={{
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: 700,
                  textDecoration: 'none',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.15)',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>Emergency Page</span>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>arrow_forward</span>
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
