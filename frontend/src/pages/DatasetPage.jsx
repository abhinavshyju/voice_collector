import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';
import AudioPlayer from '../components/AudioPlayer';
import TranslitTextarea from '../components/TranslitTextarea';

export default function DatasetPage({ onToast }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ hf_token: '', hf_repo: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [recs, s] = await Promise.all([
        api.getRecordings({ status: 'accepted' }),
        api.getSettings(),
      ]);
      setRecordings(recs);
      setSettings({ hf_token: '', hf_repo: s.hf_repo || '' });
    } catch (err) {
      onToast(err.message, 'error');
    }
    setLoading(false);
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const saveTranscript = async (id) => {
    try {
      await api.updateRecording(id, { final_transcript: editText });
      setRecordings(prev => prev.map(r => r.id === id ? { ...r, final_transcript: editText } : r));
      setEditId(null);
      onToast('Transcript saved', 'success');
    } catch (err) {
      onToast('Save failed: ' + err.message, 'error');
    }
  };

  const handleSync = async () => {
    const s = await api.getSettings();
    if (!s.hf_repo || !s.hf_token_masked) {
      setShowSettings(true);
      onToast('Configure HuggingFace settings first', 'error');
      return;
    }
    setSyncing(true);
    try {
      const result = await api.syncToHub();
      onToast(`Synced ${result.recordings_synced} recordings to ${result.repo}`, 'success');
      load();
    } catch (err) {
      onToast('Sync failed: ' + err.message, 'error');
    }
    setSyncing(false);
  };

  const saveSettings = async () => {
    try {
      const payload = {};
      if (settings.hf_token) payload.hf_token = settings.hf_token;
      if (settings.hf_repo) payload.hf_repo = settings.hf_repo;
      await api.updateSettings(payload);
      setShowSettings(false);
      onToast('Settings saved', 'success');
    } catch (err) {
      onToast('Failed to save settings: ' + err.message, 'error');
    }
  };

  const deleteRec = async (id) => {
    try {
      await api.deleteRecording(id);
      setRecordings(prev => prev.filter(r => r.id !== id));
      onToast('Recording removed', 'success');
    } catch (err) {
      onToast(err.message, 'error');
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1>Dataset</h1>
        <p>{recordings.length} accepted recording{recordings.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="sync-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)}>⚙️ Settings</button>
          <span className="sync-status">{recordings.length} files ready</span>
        </div>
        <button className="btn btn-primary" onClick={handleSync} disabled={syncing || recordings.length === 0}>
          {syncing ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="spinner" style={{ width: 14, height: 14 }} />
              Syncing...
            </span>
          ) : '🚀 Sync to HuggingFace'}
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      ) : recordings.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7V4a2 2 0 0 1 2-2h8.5L20 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3"/><polyline points="14 2 14 8 20 8"/></svg>
          <h3>No accepted recordings</h3>
          <p>Accept recordings from the Review Queue to build your dataset.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="dataset-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Audio</th>
                <th>Duration</th>
                <th>Emotion</th>
                <th>Speaker</th>
                <th style={{ minWidth: 250 }}>Transcript</th>
                <th>Synced</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recordings.map((rec, i) => (
                <tr key={rec.id}>
                  <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                  <td><AudioPlayer recordingId={rec.id} /></td>
                  <td>
                    <span className={`duration-badge ${rec.duration >= 8 && rec.duration <= 12 ? 'duration-ideal' : rec.duration >= 3 ? 'duration-warn' : 'duration-error'}`}>
                      {rec.duration?.toFixed(1)}s
                    </span>
                  </td>
                  <td><span className="emotion-badge">{rec.emotion || 'neutral'}</span></td>
                  <td style={{ fontSize: 13 }}>{rec.speaker_name || rec.speaker_id}</td>
                  <td>
                    {editId === rec.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <TranslitTextarea value={editText} onChange={setEditText} rows={2} />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-success btn-sm" onClick={() => saveTranscript(rec.id)}>Save</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <span
                        className="inline-edit"
                        style={{ cursor: 'pointer', display: 'block' }}
                        onClick={() => { setEditId(rec.id); setEditText(rec.final_transcript || ''); }}
                        title="Click to edit"
                      >
                        {rec.final_transcript || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Empty</span>}
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {rec.synced_at ? new Date(rec.synced_at).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteRec(rec.id)} title="Remove">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>HuggingFace Settings</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label>HF Write Token</label>
                <input className="input" type="password" value={settings.hf_token} onChange={e => setSettings(p => ({...p, hf_token: e.target.value}))} placeholder="hf_..." />
              </div>
              <div className="form-group">
                <label>Dataset Repo ID</label>
                <input className="input" value={settings.hf_repo} onChange={e => setSettings(p => ({...p, hf_repo: e.target.value}))} placeholder="username/dataset-name" />
              </div>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setShowSettings(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveSettings}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
