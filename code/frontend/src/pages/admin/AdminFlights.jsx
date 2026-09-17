import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../api/client.js';
import { FlightManager } from '../OpsCore.jsx';
import { styles } from '../../styles.js';

export default function AdminFlights() {
  const { token } = useAuth();
  const [airports, setAirports] = useState([]);
  const [aircraftTypes, setAircraftTypes] = useState([]);
  const [gates, setGates] = useState([]);

  useEffect(() => {
    apiFetch('/airports').then((d) => setAirports(d.airports)).catch(() => {});
    apiFetch('/aircraft-types').then((d) => setAircraftTypes(d.aircraft_types)).catch(() => {});
    apiFetch('/gates').then((d) => setGates(d.gates)).catch(() => {});
  }, []);

  return (
    <div>
      <h1 style={styles.title}>Flights</h1>
      <FlightManager token={token} airports={airports} aircraftTypes={aircraftTypes} gates={gates} />
    </div>
  );
}
