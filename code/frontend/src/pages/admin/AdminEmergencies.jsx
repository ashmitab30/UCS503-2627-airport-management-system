import { useAuth } from '../../context/AuthContext.jsx';
import EmergencyBoard from '../EmergencyBoard.jsx';
import { styles } from '../../styles.js';

export default function AdminEmergencies() {
  const { token } = useAuth();
  return (
    <div>
      <h1 style={styles.title}>Emergencies</h1>
      <EmergencyBoard token={token} />
    </div>
  );
}
