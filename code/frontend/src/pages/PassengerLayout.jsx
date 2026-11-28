import { Outlet } from 'react-router-dom';
import FloatingChat from '../components/chat/FloatingChat.jsx';

/**
 * Shared layout for passenger-facing routes.
 * Mounts the FloatingChat assistant once across all passenger pages.
 */
export default function PassengerLayout() {
  return (
    <>
      <Outlet />
      <FloatingChat />
    </>
  );
}
