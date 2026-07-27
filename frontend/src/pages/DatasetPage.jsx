import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';
import AudioPlayer from '../components/AudioPlayer';
import TranslitTextarea from '../components/TranslitTextarea';
import ConfirmModal from '../components/ConfirmModal';

export default function DatasetPage({ activeSpeaker, onSpeakerUpdate, onToast }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ hf_token: '', hf_repo: '' });
  const [confirmDelete, setConfirmDelete] = useState({ isOpen: false, id: null });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [recs, s] = await Promise.all([
        api.getRecordings({ status: 'accepted', speaker_id: activeSpeaker.id }),
        api.getSettings(),
      ]);
      setRecordings(recs);
      setSettings({ hf_token: '', hf_repo: activeSpeaker.hf_repo || '' });
    } catch (err) {
      onToast(err.message, 'error');
    }
    setLoading(false);
  }, [onToast, activeSpeaker]);

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
    if (!activeSpeaker.hf_repo || !s.hf_token_masked) {
      setShowSettings(true);
      onToast('Configure HuggingFace settings first', 'error');
      return;
    }
    setSyncing(true);
    try {
      const result = await api.syncToHub(activeSpeaker.id);
      onToast(`Synced ${result.recordings_synced} recordings to ${result.repo}`, 'success');
      load();
    } catch (err) {
      onToast('Sync failed: ' + err.message, 'error');
    }
    setSyncing(false);
  };

  const saveSettings = async () => {
    try {
      if (settings.hf_token) {
        await api.updateSettings({ hf_token: settings.hf_token });
      }
      const updated = await api.updateSpeaker(activeSpeaker.id, { hf_repo: settings.hf_repo });
      onSpeakerUpdate?.(updated);
      setShowSettings(false);
      onToast('Settings saved', 'success');
    } catch (err) {
      onToast('Failed to save settings: ' + err.message, 'error');
    }
  };

  const handleDeleteClick = (id) => {
    setConfirmDelete({ isOpen: true, id });
  };

  const handleConfirmDelete = async () => {
    const id = confirmDelete.id;
    setConfirmDelete({ isOpen: false, id: null });
    if (!id) return;
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
        <p>{recordings.length} accepted recording{recordings.length !== 1 ? 's' : ''} for {activeSpeaker.name}</p>
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
          <p>Accept recordings from the Review Queue to build this speaker&apos;s dataset.</p>
        </div>
      ) : (
        <>
          <div className="dataset-desktop-view" style={{ overflowX: 'auto' }}>
            <table className="dataset-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Audio</th>
                  <th>Duration</th>
                  <th>Emotion</th>
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
                      <button
                        className="btn btn-danger btn-sm btn-icon"
                        style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                        onClick={() => handleDeleteClick(rec.id)}
                        title="Remove"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="dataset-mobile-view">
            {recordings.map((rec, i) => (
              <div key={rec.id} className="dataset-card">
                <div className="dataset-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>#{i + 1}</span>
                    <AudioPlayer recordingId={rec.id} />
                  </div>
                  <button
                    className="btn btn-danger btn-sm btn-icon"
                    style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                    onClick={() => handleDeleteClick(rec.id)}
                    title="Remove"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>

                <div className="dataset-card-body">
                  <div className="dataset-card-row">
                    <span className="label">Specs</span>
                    <div className="value" style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <span className={`duration-badge ${rec.duration >= 8 && rec.duration <= 12 ? 'duration-ideal' : rec.duration >= 3 ? 'duration-warn' : 'duration-error'}`}>
                        {rec.duration?.toFixed(1)}s
                      </span>
                      <span className="emotion-badge">{rec.emotion || 'neutral'}</span>
                    </div>
                  </div>
                  <div className="dataset-card-row">
                    <span className="label">Synced</span>
                    <span className="value" style={{ color: 'var(--text-muted)' }}>
                      {rec.synced_at ? new Date(rec.synced_at).toLocaleDateString() : '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                    <span className="label" style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Transcript</span>
                    {editId === rec.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <TranslitTextarea value={editText} onChange={setEditText} rows={2} />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-success btn-sm" onClick={() => saveTranscript(rec.id)}>Save</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <span
                        className="inline-edit"
                        style={{ cursor: 'pointer', display: 'block', padding: '6px 8px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: '6px' }}
                        onClick={() => { setEditId(rec.id); setEditText(rec.final_transcript || ''); }}
                        title="Click to edit"
                      >
                        {rec.final_transcript || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Empty</span>}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <ConfirmModal
            isOpen={confirmDelete.isOpen}
            title="Remove from Dataset"
            message="Are you sure you want to remove this recording from the dataset? This action is permanent."
            onConfirm={handleConfirmDelete}
            onCancel={() => setConfirmDelete({ isOpen: false, id: null })}
          />
        </>
      )}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>HuggingFace Settings</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 4 }}>
              Settings for {activeSpeaker.name}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label>HF Write Token (global)</label>
                <input className="input" type="password" value={settings.hf_token} onChange={e => setSettings(p => ({...p, hf_token: e.target.value}))} placeholder="hf_..." />
              </div>
              <div className="form-group">
                <label>Dataset Repo ID (this speaker)</label>
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
