import { useAuth } from '../../context/AuthContext.jsx';
import AssistanceQueue from '../AssistanceQueue.jsx';
import { styles } from '../../styles.js';

export default function StaffAssistance() {
  const { token } = useAuth();
  return (
    <div>
      <h1 style={styles.title}>Assistance queue</h1>
      <p style={styles.subtitle}>Special assistance requests from passengers. Move each one forward as you act on it.</p>
      <AssistanceQueue token={token} />
    </div>
  );
}
