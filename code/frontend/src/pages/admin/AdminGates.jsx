import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../api/client.js';
import { ReferenceData, GateManager } from '../OpsCore.jsx';
import { styles } from '../../styles.js';

export default function AdminGates() {
  const { token, user } = useAuth();
  const [airports, setAirports] = useState([]);
  const [aircraftTypes, setAircraftTypes] = useState([]);
  const [gates, setGates] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    apiFetch('/airports').then((d) => setAirports(d.airports)).catch(() => {});
    apiFetch('/aircraft-types').then((d) => setAircraftTypes(d.aircraft_types)).catch(() => {});
    apiFetch('/gates').then((d) => setGates(d.gates)).catch(() => {});
  }, [refreshKey]);

  return (
    <div>
      <h1 style={styles.title}>Gates &amp; reference data</h1>
      {user.role === 'admin' && (
        <ReferenceData token={token} airports={airports} aircraftTypes={aircraftTypes} onChange={bump} />
      )}
      <GateManager token={token} airports={airports} gates={gates} onChange={bump} />
    </div>
  );
}
