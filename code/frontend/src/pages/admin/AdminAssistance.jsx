import { useAuth } from '../../context/AuthContext.jsx';
import AssistanceQueue from '../AssistanceQueue.jsx';
import { styles } from '../../styles.js';

export default function AdminAssistance() {
  const { token } = useAuth();
  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={styles.title}>Passenger Special Assistance &amp; Care</h1>
        <p style={styles.subtitle}>
          Oversee, filter, and reassign special assistance requests across all flights and terminal facilities.
        </p>
      </div>
      <AssistanceQueue token={token} />
    </div>
  );
}
