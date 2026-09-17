import { useAuth } from '../../context/AuthContext.jsx';
import AssistanceQueue from '../AssistanceQueue.jsx';
import { styles } from '../../styles.js';

export default function AdminAssistance() {
  const { token } = useAuth();
  return (
    <div>
      <h1 style={styles.title}>Assistance requests</h1>
      <AssistanceQueue token={token} />
    </div>
  );
}
