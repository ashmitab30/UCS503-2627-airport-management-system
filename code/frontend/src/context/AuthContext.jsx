import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

const AuthContext = createContext(null);
const STORAGE_KEY = 'ams_token';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount / whenever the token changes, validate it against
  // GET /auth/me. This is what turns "a string in localStorage" into
  // "an actual logged-in session" — an expired/invalid token gets
  // cleared instead of silently pretending the user is authenticated.
  useEffect(() => {
    let cancelled = false;
    async function loadUser() {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const { user } = await apiFetch('/auth/me', { token });
        if (!cancelled) setUser(user);
      } catch {
        if (!cancelled) {
          setToken(null);
          setUser(null);
          localStorage.removeItem(STORAGE_KEY);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadUser();
    return () => { cancelled = true; };
  }, [token]);

  const login = useCallback(async (email, password) => {
    const data = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
    localStorage.setItem(STORAGE_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const data = await apiFetch('/auth/register', { method: 'POST', body: { name, email, password } });
    localStorage.setItem(STORAGE_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
