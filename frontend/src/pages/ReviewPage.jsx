import { useState, useEffect, useCallback } from 'react';
import { api, EMOTIONS } from '../utils/api';
import AudioPlayer from '../components/AudioPlayer';
import TranslitTextarea from '../components/TranslitTextarea';
import ConfirmModal from '../components/ConfirmModal';

function durationBadgeClass(duration, processingStatus) {
  if (processingStatus === 'error') return 'duration-error';
  if (duration == null) return '';
  if (duration >= 3 && duration < 8) return 'duration-warn';
  if (duration >= 8 && duration <= 12) return 'duration-ideal';
  if (duration > 12 && duration <= 20) return 'duration-warn';
  return 'duration-error';
}

export default function ReviewPage({ activeSpeaker, onToast, onCountUpdate, isAdmin }) {
  const speakerId = activeSpeaker.id;
  const speakerParams = { speaker_id: speakerId };

  const [view, setView] = useState('pending');
  const [recordings, setRecordings] = useState([]);
  const [acceptedRecordings, setAcceptedRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editEmotion, setEditEmotion] = useState('neutral');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState({ isOpen: false, id: null });

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      setRecordings(await api.getRecordings({ status: 'pending', ...speakerParams }));
    } catch (err) {
      onToast(err.message, 'error');
    }
    setLoading(false);
  }, [onToast, speakerId]);

  const loadAccepted = useCallback(async () => {
    setLoading(true);
    try {
      setAcceptedRecordings(await api.getRecordings({ status: 'accepted', ...speakerParams }));
    } catch (err) {
      onToast(err.message, 'error');
    }
    setLoading(false);
  }, [onToast, speakerId]);

  const load = useCallback(async () => {
    if (view === 'pending') await loadPending();
    else await loadAccepted();
  }, [view, loadPending, loadAccepted]);

  useEffect(() => {
    api.getRecordings({ status: 'accepted', ...speakerParams }).then(setAcceptedRecordings).catch(() => {});
  }, [speakerId]);

  useEffect(() => { load(); }, [load]);

  const cancelEdit = () => {
    setEditId(null);
    setEditText('');
    setEditEmotion('neutral');
  };

  useEffect(() => {
    const hasProcessing = recordings.some(r => r.processing_status === 'pending');
    if (!hasProcessing) return;

    const interval = setInterval(async () => {
      try {
        const data = await api.getRecordings({ status: 'pending', ...speakerParams });
        setRecordings(data);
      } catch (err) {
        onToast(err.message, 'error');
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [recordings, onToast, speakerId]);

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
      if (editId === rec.id) cancelEdit();
      api.getRecordings({ status: 'accepted', ...speakerParams }).then(setAcceptedRecordings).catch(() => {});
    } catch (err) {
      onToast('Failed to accept: ' + err.message, 'error');
    }
  };

  const handleRejectClick = (id) => {
    setConfirmDelete({ isOpen: true, id });
  };

  const handleConfirmReject = async () => {
    const id = confirmDelete.id;
    setConfirmDelete({ isOpen: false, id: null });
    if (!id) return;
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
    api.getRecordings({ status: 'accepted', ...speakerParams }).then(setAcceptedRecordings).catch(() => {});
  };

  const startEdit = (rec) => {
    setEditId(rec.id);
    setEditText(rec.final_transcript || rec.whisper_transcript || '');
    setEditEmotion(rec.emotion || 'neutral');
  };

  const saveAccepted = async (rec) => {
    setSaving(true);
    try {
      const updated = await api.updateRecording(rec.id, {
        final_transcript: editText,
        emotion: editEmotion,
      });
      setAcceptedRecordings(prev => prev.map(r => r.id === rec.id ? updated : r));
      cancelEdit();
      onToast('Recording updated', 'success');
    } catch (err) {
      onToast('Failed to save: ' + err.message, 'error');
    }
    setSaving(false);
  };

  const switchView = (next) => {
    if (next === view) return;
    cancelEdit();
    setView(next);
  };

  const activeList = view === 'pending' ? recordings : acceptedRecordings;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1>Review Queue</h1>
            <p>
              {view === 'pending'
                ? `${recordings.length} recording${recordings.length !== 1 ? 's' : ''} pending review`
                : `${acceptedRecordings.length} accepted recording${acceptedRecordings.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          {view === 'pending' && recordings.filter(canAccept).length > 1 && (
            <button className="btn btn-success btn-sm" onClick={acceptAll}>Accept All</button>
          )}
        </div>
        <div className="view-tabs" style={{ marginTop: 16 }}>
          <button
            className={`view-tab ${view === 'pending' ? 'active' : ''}`}
            onClick={() => switchView('pending')}
          >
            Pending{recordings.length > 0 ? ` (${recordings.length})` : ''}
          </button>
          <button
            className={`view-tab ${view === 'accepted' ? 'active' : ''}`}
            onClick={() => switchView('accepted')}
          >
            Accepted{acceptedRecordings.length > 0 ? ` (${acceptedRecordings.length})` : ''}
          </button>
        </div>

        <ConfirmModal
          isOpen={confirmDelete.isOpen}
          title="Delete Recording"
          message="Are you sure you want to delete this recording? It will be permanently removed from the pending review list."
          onConfirm={handleConfirmReject}
          onCancel={() => setConfirmDelete({ isOpen: false, id: null })}
        />
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      ) : activeList.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <h3>{view === 'pending' ? 'Queue is empty' : 'No accepted recordings'}</h3>
          <p>
            {view === 'pending'
              ? 'All recordings have been reviewed. Go record some more!'
              : 'Accept recordings from the Pending tab to see them here.'}
          </p>
        </div>
      ) : (
        <div className="rec-list">
          {activeList.map(rec => {
            const isPending = rec.processing_status === 'pending';
            const isError = rec.processing_status === 'error';
            const ready = view === 'accepted' || canAccept(rec);
            const isEditing = editId === rec.id;

            return (
              <div key={rec.id} className={`rec-item ${isError ? 'rec-item-error' : ''}`} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
                <div className="rec-header">
                  <AudioPlayer recordingId={rec.id} disabled={!ready} />
                  <div className="rec-meta" style={{ flex: 1 }}>
                    <div className="info">
                      <span className={`duration-badge ${durationBadgeClass(rec.duration, rec.processing_status)}`}>
                        {isPending ? 'Processing...' : isError ? 'Error' : `${rec.duration?.toFixed(1)}s`}
                      </span>
                      {isAdmin && rec.owner_username && (
                        <span style={{ color: 'var(--accent)' }}>@{rec.owner_username}</span>
                      )}
                      <span className="emotion-badge">{rec.emotion || 'neutral'}</span>
                      <span>{new Date(rec.created_at).toLocaleTimeString()}</span>
                    </div>
                  </div>
                  <div className="rec-actions">
                    {view === 'pending' ? (
                      <>
                        {!isError && (
                          <>
                            <button
                              className="btn btn-ghost btn-sm btn-icon"
                              style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                              onClick={() => startEdit(rec)}
                              title="Edit transcript"
                              disabled={!ready}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                              </svg>
                            </button>
                            <button
                              className="btn btn-success btn-sm btn-icon"
                              style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                              onClick={() => accept(rec)}
                              title="Accept"
                              disabled={!ready}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            </button>
                          </>
                        )}
                        <button
                          className="btn btn-danger btn-sm btn-icon"
                          style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                          onClick={() => handleRejectClick(rec.id)}
                          title="Delete"
                          disabled={isPending}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      </>
                    ) : isEditing ? (
                      <>
                        <button className="btn btn-success btn-sm" onClick={() => saveAccepted(rec)} title="Save" disabled={saving}>
                          Save
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={cancelEdit} title="Cancel" disabled={saving}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-ghost btn-sm btn-icon"
                        style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                        onClick={() => startEdit(rec)}
                        title="Edit transcript"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {view === 'pending' ? (
                  <div style={{ padding: '0 4px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Auto Transcript
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
                ) : !isEditing && (
                  <div style={{ padding: '0 4px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Final Transcript
                    </div>
                    <p className="transcript" style={{ fontSize: 15, lineHeight: 1.6 }}>
                      {rec.final_transcript || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No transcript</span>}
                    </p>
                  </div>
                )}

                {isEditing && (
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
