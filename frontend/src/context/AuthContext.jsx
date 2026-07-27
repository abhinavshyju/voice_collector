import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setToken, setOnUnauthorized } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authView, setAuthView] = useState('login');

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setAuthView('login');
  }, []);

  useEffect(() => {
    setOnUnauthorized(logout);
    const token = localStorage.getItem('voice_collector_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api.getMe()
      .then(u => setUser(u))
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [logout]);

  const login = async (username, password) => {
    const res = await api.login(username, password);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  };

  const signup = async (name, username, password) => {
    const res = await api.signup(name, username, password);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  };

  const value = {
    user,
    loading,
    isAdmin: Boolean(user?.is_admin),
    isAuthenticated: Boolean(user),
    authView,
    setAuthView,
    login,
    signup,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
