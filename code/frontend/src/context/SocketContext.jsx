import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext.jsx';

const SocketContext = createContext({
  socket: null,
  connected: false,
  status: 'disconnected', // 'connected' | 'reconnecting' | 'disconnected'
});

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function SocketProvider({ children }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState('disconnected');
  const socketRef = useRef(null);

  useEffect(() => {
    if (!token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocket(null);
      setStatus('disconnected');
      return;
    }

    const s = io(SOCKET_URL, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
    });

    socketRef.current = s;

    s.on('connect', () => {
      setStatus('connected');
    });

    s.on('disconnect', (reason) => {
      if (reason === 'io server disconnect' || reason === 'io client disconnect') {
        setStatus('disconnected');
      } else {
        setStatus('reconnecting');
      }
    });

    s.on('reconnect_attempt', () => {
      setStatus('reconnecting');
    });

    s.on('reconnect', () => {
      setStatus('connected');
    });

    s.on('auth_error', () => {
      setStatus('disconnected');
      s.disconnect();
    });

    setSocket(s);

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  return (
    <SocketContext.Provider value={{ socket, connected: status === 'connected', status }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

export function LiveStatusPill({ className = '' }) {
  const { status } = useSocket();

  if (status === 'connected') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm ${className}`}
        title="Live real-time feed connected"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        Live
      </span>
    );
  }

  if (status === 'reconnecting') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm ${className}`}
        title="Reconnecting to real-time feed..."
      >
        <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
        Reconnecting...
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20 shadow-sm ${className}`}
      title="Real-time updates disconnected"
    >
      <span className="w-2 h-2 rounded-full bg-slate-500" />
      Offline
    </span>
  );
}
