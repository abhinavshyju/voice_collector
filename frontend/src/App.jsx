import { useState, useEffect, useCallback } from 'react';
import SpeakersPage from './pages/SpeakersPage';
import RecorderPage from './pages/RecorderPage';
import ReviewPage from './pages/ReviewPage';
import DatasetPage from './pages/DatasetPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import { api } from './utils/api';

const TABS = [
  { id: 'speakers', label: 'Speakers', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
  { id: 'record', label: 'Record', requiresSpeaker: true, icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> },
  { id: 'review', label: 'Review', requiresSpeaker: true, icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
  { id: 'dataset', label: 'Dataset', requiresSpeaker: true, adminOnly: true, icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7V4a2 2 0 0 1 2-2h8.5L20 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3"/><polyline points="14 2 14 8 20 8"/></svg> },
];

function AppContent() {
  const { user, loading, isAdmin, isAuthenticated, authView, logout } = useAuth();
  const [tab, setTab] = useState('speakers');
  const [activeSpeaker, setActiveSpeaker] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);

  const tabs = TABS.filter(t => !t.adminOnly || isAdmin);

  const loadCounts = useCallback(async () => {
    if (!activeSpeaker) {
      setPendingCount(0);
      return;
    }
    try {
      const c = await api.getRecordingCounts(activeSpeaker.id);
      setPendingCount(c.pending);
    } catch (err) {
      console.error('Failed to load counts:', err.message);
    }
  }, [activeSpeaker]);

  useEffect(() => {
    if (isAuthenticated && activeSpeaker) loadCounts();
  }, [isAuthenticated, activeSpeaker, loadCounts]);

  useEffect(() => {
    if (!isAdmin && tab === 'dataset') setTab('speakers');
  }, [isAdmin, tab]);

  const toast = useCallback((msg, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  const handleSelectSpeaker = (s) => {
    setActiveSpeaker(s);
    if (s) {
      setTab('record');
    } else {
      setTab('speakers');
    }
  };

  const handleSpeakerUpdate = (updated) => {
    setActiveSpeaker(updated);
  };

  const handleTabChange = (nextTab) => {
    const tabDef = tabs.find(t => t.id === nextTab);
    if (tabDef?.requiresSpeaker && !activeSpeaker) {
      toast('Select or create a speaker first', 'error');
      setTab('speakers');
      return;
    }
    setTab(nextTab);
  };

  if (loading) {
    return (
      <div className="auth-page">
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return authView === 'signup' ? <SignupPage /> : <LoginPage />;
  }

  return (
    <div className="app-layout">
      <div className="app-topbar">
        <div className="app-user">
          <span>{user.name}</span>
          <span className="app-username">@{user.username}</span>
          {isAdmin && <span className="admin-badge">Admin</span>}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={logout}>Logout</button>
      </div>

      {activeSpeaker && tab !== 'speakers' && (
        <div className="speaker-context-bar">
          <div className="speaker-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            {activeSpeaker.name}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setTab('speakers')}>Change speaker</button>
        </div>
      )}

      <div className="app-content">
        {tab === 'speakers' && (
          <SpeakersPage
            activeSpeaker={activeSpeaker}
            onSelectSpeaker={handleSelectSpeaker}
            onToast={toast}
            isAdmin={isAdmin}
          />
        )}
        {tab === 'record' && activeSpeaker && (
          <RecorderPage activeSpeaker={activeSpeaker} onToast={toast} onCountUpdate={loadCounts} />
        )}
        {tab === 'review' && activeSpeaker && (
          <ReviewPage
            activeSpeaker={activeSpeaker}
            onToast={toast}
            onCountUpdate={loadCounts}
            isAdmin={isAdmin}
          />
        )}
        {tab === 'dataset' && isAdmin && activeSpeaker && (
          <DatasetPage
            activeSpeaker={activeSpeaker}
            onSpeakerUpdate={handleSpeakerUpdate}
            onToast={toast}
          />
        )}
      </div>

      <nav className="nav-bar">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`nav-item ${tab === t.id ? 'active' : ''} ${t.requiresSpeaker && !activeSpeaker ? 'nav-item-disabled' : ''}`}
            onClick={() => handleTabChange(t.id)}
          >
            {t.icon}
            {t.label}
            {t.id === 'review' && pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
          </button>
        ))}
      </nav>

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
