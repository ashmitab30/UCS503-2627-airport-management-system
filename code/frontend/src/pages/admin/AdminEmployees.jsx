import { useAuth } from '../../context/AuthContext.jsx';
import { StaffManagement } from '../Dashboard.jsx';
import { styles } from '../../styles.js';

export default function AdminEmployees() {
  const { token } = useAuth();
  return (
    <div>
      <h1 style={styles.title}>Employees</h1>
      <StaffManagement token={token} />
    </div>
  );
}
