import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../api/client.js';
import { ResourceManager } from '../OpsCore.jsx';
import { styles } from '../../styles.js';

export default function AdminResources() {
  const { token } = useAuth();
  const [airports, setAirports] = useState([]);

  useEffect(() => {
    apiFetch('/airports').then((d) => setAirports(d.airports)).catch(() => {});
  }, []);

  return (
    <div>
      <h1 style={styles.title}>Resources</h1>
      <ResourceManager token={token} airports={airports} />
    </div>
  );
}
