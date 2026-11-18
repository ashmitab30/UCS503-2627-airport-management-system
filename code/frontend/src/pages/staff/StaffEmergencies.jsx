import { useAuth } from '../../context/AuthContext.jsx';
import EmergencyBoard from '../EmergencyBoard.jsx';
import { styles } from '../../styles.js';

export default function StaffEmergencies() {
  const { token } = useAuth();
  return (
    <div>
      <h1 style={styles.title}>Emergencies</h1>
      <p style={styles.subtitle}>Emergencies that involve your team. Acknowledge them and resolve them here.</p>
      <EmergencyBoard token={token} />
    </div>
  );
}
