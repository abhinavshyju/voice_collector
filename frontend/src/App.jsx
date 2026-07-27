import { useState, useEffect, useCallback } from 'react';
import SpeakersPage from './pages/SpeakersPage';
import RecorderPage from './pages/RecorderPage';
import ReviewPage from './pages/ReviewPage';
import DatasetPage from './pages/DatasetPage';
import { api } from './utils/api';

const TABS = [
  { id: 'speakers', label: 'Speakers', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
  { id: 'record', label: 'Record', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> },
  { id: 'review', label: 'Review', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
  { id: 'dataset', label: 'Dataset', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7V4a2 2 0 0 1 2-2h8.5L20 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3"/><polyline points="14 2 14 8 20 8"/></svg> },
];

const SPEAKER_STORAGE_KEY = 'voice_collector_active_speaker';

export default function App() {
  const [tab, setTab] = useState('speakers');
  const [activeSpeaker, setActiveSpeaker] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);

  const loadCounts = useCallback(async () => {
    try {
      const c = await api.getRecordingCounts();
      setPendingCount(c.pending);
    } catch (err) {
      console.error('Failed to load counts:', err.message);
    }
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  // Restore active speaker from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(SPEAKER_STORAGE_KEY);
    if (!stored) return;
    try {
      const speaker = JSON.parse(stored);
      api.getSpeakers().then(speakers => {
        const found = speakers.find(s => s.id === speaker.id);
        if (found) setActiveSpeaker(found);
        else localStorage.removeItem(SPEAKER_STORAGE_KEY);
      }).catch(() => {});
    } catch {
      localStorage.removeItem(SPEAKER_STORAGE_KEY);
    }
  }, []);

  const toast = useCallback((msg, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  const handleSelectSpeaker = (s) => {
    setActiveSpeaker(s);
    if (s) {
      localStorage.setItem(SPEAKER_STORAGE_KEY, JSON.stringify(s));
      setTab('record');
    } else {
      localStorage.removeItem(SPEAKER_STORAGE_KEY);
    }
  };

  return (
    <div className="app-layout">
      <div className="app-content">
        {tab === 'speakers' && <SpeakersPage activeSpeaker={activeSpeaker} onSelectSpeaker={handleSelectSpeaker} onToast={toast} />}
        {tab === 'record' && <RecorderPage activeSpeaker={activeSpeaker} onToast={toast} onCountUpdate={loadCounts} />}
        {tab === 'review' && <ReviewPage onToast={toast} onCountUpdate={loadCounts} />}
        {tab === 'dataset' && <DatasetPage onToast={toast} />}
      </div>

      <nav className="nav-bar">
        {TABS.map(t => (
          <button key={t.id} className={`nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
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
