import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../api/client.js';
import { FlightManager } from '../OpsCore.jsx';
import { styles } from '../../styles.js';
import LogDelayModal from '../../components/flights/LogDelayModal.jsx';

export default function AdminFlights() {
  const { token } = useAuth();
  const [airports, setAirports] = useState([]);
  const [aircraftTypes, setAircraftTypes] = useState([]);
  const [gates, setGates] = useState([]);
  const [showDelayModal, setShowDelayModal] = useState(false);

  useEffect(() => {
    apiFetch('/airports').then((d) => setAirports(d.airports)).catch(() => {});
    apiFetch('/aircraft-types').then((d) => setAircraftTypes(d.aircraft_types)).catch(() => {});
    apiFetch('/gates').then((d) => setGates(d.gates)).catch(() => {});
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ ...styles.title, margin: 0 }}>Flights</h1>
        <button
          type="button"
          onClick={() => setShowDelayModal(true)}
          className="btn-secondary-aero"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '8px 16px' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#d97706' }}>
            schedule
          </span>
          <span>Log Flight Delay</span>
        </button>
      </div>
      <FlightManager token={token} airports={airports} aircraftTypes={aircraftTypes} gates={gates} />
      <LogDelayModal
        isOpen={showDelayModal}
        onClose={() => setShowDelayModal(false)}
      />
    </div>
  );
}
