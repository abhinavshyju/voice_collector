import { useState, useEffect, useCallback } from 'react';
import { api, EMOTIONS } from '../utils/api';
import AudioPlayer from '../components/AudioPlayer';
import TranslitTextarea from '../components/TranslitTextarea';

function durationBadgeClass(duration, processingStatus) {
  if (processingStatus === 'error') return 'duration-error';
  if (duration == null) return '';
  if (duration >= 3 && duration < 8) return 'duration-warn';
  if (duration >= 8 && duration <= 12) return 'duration-ideal';
  if (duration > 12 && duration <= 20) return 'duration-warn';
  return 'duration-error';
}

export default function ReviewPage({ onToast, onCountUpdate }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editEmotion, setEditEmotion] = useState('neutral');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRecordings(await api.getRecordings({ status: 'pending' }));
    } catch (err) {
      onToast(err.message, 'error');
    }
    setLoading(false);
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const hasProcessing = recordings.some(r => r.processing_status === 'pending');
    if (!hasProcessing) return;

    const interval = setInterval(async () => {
      try {
        const data = await api.getRecordings({ status: 'pending' });
        setRecordings(data);
      } catch (err) {
        onToast(err.message, 'error');
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [recordings, onToast]);

  const canAccept = (rec) => rec.processing_status === 'ready' && rec.duration >= 3;

  const accept = async (rec) => {
    if (!canAccept(rec)) return;
    try {
      const transcript = editId === rec.id ? editText : (rec.final_transcript || rec.whisper_transcript);
      const emotion = editId === rec.id ? editEmotion : (rec.emotion || 'neutral');
      await api.updateRecording(rec.id, { status: 'accepted', final_transcript: transcript, emotion });
      setRecordings(prev => prev.filter(r => r.id !== rec.id));
      onToast('Recording accepted', 'success');
      onCountUpdate?.();
      if (editId === rec.id) { setEditId(null); setEditText(''); }
    } catch (err) {
      onToast('Failed to accept: ' + err.message, 'error');
    }
  };

  const reject = async (id) => {
    try {
      await api.deleteRecording(id);
      setRecordings(prev => prev.filter(r => r.id !== id));
      onToast('Recording deleted', 'success');
      onCountUpdate?.();
    } catch (err) {
      onToast('Failed to delete: ' + err.message, 'error');
    }
  };

  const acceptAll = async () => {
    const ready = recordings.filter(canAccept);
    for (const rec of ready) {
      try {
        const transcript = editId === rec.id ? editText : (rec.final_transcript || rec.whisper_transcript);
        const emotion = editId === rec.id ? editEmotion : (rec.emotion || 'neutral');
        await api.updateRecording(rec.id, { status: 'accepted', final_transcript: transcript, emotion });
      } catch (err) {
        onToast('Failed to accept recording: ' + err.message, 'error');
      }
    }
    setRecordings(prev => prev.filter(r => !canAccept(r)));
    onToast(`Accepted ${ready.length} recording(s)`, 'success');
    onCountUpdate?.();
  };

  const startEdit = (rec) => {
    setEditId(rec.id);
    setEditText(rec.final_transcript || rec.whisper_transcript || '');
    setEditEmotion(rec.emotion || 'neutral');
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1>Review Queue</h1>
            <p>{recordings.length} recording{recordings.length !== 1 ? 's' : ''} pending review</p>
          </div>
          {recordings.filter(canAccept).length > 1 && (
            <button className="btn btn-success btn-sm" onClick={acceptAll}>Accept All</button>
          )}
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      ) : recordings.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <h3>Queue is empty</h3>
          <p>All recordings have been reviewed. Go record some more!</p>
        </div>
      ) : (
        <div className="rec-list">
          {recordings.map(rec => {
            const isPending = rec.processing_status === 'pending';
            const isError = rec.processing_status === 'error';
            const ready = canAccept(rec);

            return (
              <div key={rec.id} className={`rec-item ${isError ? 'rec-item-error' : ''}`} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <AudioPlayer recordingId={rec.id} disabled={!ready} />
                  <div className="rec-meta" style={{ flex: 1 }}>
                    <div className="info">
                      <span className={`duration-badge ${durationBadgeClass(rec.duration, rec.processing_status)}`}>
                        {isPending ? 'Processing...' : isError ? 'Error' : `${rec.duration?.toFixed(1)}s`}
                      </span>
                      <span>{rec.speaker_name || rec.speaker_id}</span>
                      <span className="emotion-badge">{rec.emotion || 'neutral'}</span>
                      <span>{new Date(rec.created_at).toLocaleTimeString()}</span>
                    </div>
                  </div>
                  <div className="rec-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => startEdit(rec)} title="Edit transcript" disabled={!ready}>
                      ✏️
                    </button>
                    <button className="btn btn-success btn-sm" onClick={() => accept(rec)} title="Accept" disabled={!ready}>
                      ✓
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => reject(rec.id)} title="Delete">
                      ✕
                    </button>
                  </div>
                </div>

                <div style={{ padding: '0 4px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Whisper Transcript
                  </div>
                  <p className="transcript" style={{ fontSize: 15, lineHeight: 1.6 }}>
                    {isPending ? (
                      <span style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="spinner" />
                        Transcribing audio in background...
                      </span>
                    ) : isError ? (
                      <span style={{ color: 'var(--danger)' }}>
                        {rec.processing_error || 'Processing failed'}
                      </span>
                    ) : (
                      rec.whisper_transcript || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No transcript</span>
                    )}
                  </p>
                </div>

                {editId === rec.id && (
                  <div style={{ padding: '0 4px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Edit Transcript (Manglish → Malayalam)
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label>Emotion</label>
                      <select className="input" value={editEmotion} onChange={e => setEditEmotion(e.target.value)}>
                        {EMOTIONS.map(e => (
                          <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                    <TranslitTextarea
                      value={editText}
                      onChange={setEditText}
                      placeholder="Type in Manglish..."
                      rows={2}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
