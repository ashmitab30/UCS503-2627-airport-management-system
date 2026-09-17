import { useAuth } from '../../context/AuthContext.jsx';
import { ShiftScheduler } from '../Dashboard.jsx';
import { styles } from '../../styles.js';

export default function AdminShifts() {
  const { token, user } = useAuth();
  return (
    <div>
      <h1 style={styles.title}>Shifts</h1>
      <ShiftScheduler token={token} isAdmin={user.role === 'admin'} />
    </div>
  );
}
