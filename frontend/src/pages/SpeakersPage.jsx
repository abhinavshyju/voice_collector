import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import ConfirmModal from '../components/ConfirmModal';

export default function SpeakersPage({ activeSpeaker, onSelectSpeaker, onToast, isAdmin }) {
  const [speakers, setSpeakers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', age: '', gender: '', district: '' });
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState({ isOpen: false, id: null, name: '' });

  const load = async () => {
    setLoading(true);
    try { setSpeakers(await api.getSpeakers()); } catch (err) { onToast?.(err.message, 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const s = await api.createSpeaker({
        name: form.name,
        age: form.age ? parseInt(form.age) : null,
        gender: form.gender || null,
        district: form.district || null,
      });
      setSpeakers(prev => [s, ...prev]);
      setShowModal(false);
      setForm({ name: '', age: '', gender: '', district: '' });
      onSelectSpeaker(s);
      onToast?.(`${s.name} created — ready to record`, 'success');
    } catch (err) { onToast?.(err.message, 'error'); }
  };

  const handleDeleteClick = (s) => {
    setConfirmDelete({ isOpen: true, id: s.id, name: s.name });
  };

  const handleConfirmDelete = async () => {
    const id = confirmDelete.id;
    setConfirmDelete({ isOpen: false, id: null, name: '' });
    if (!id) return;
    try {
      await api.deleteSpeaker(id);
      setSpeakers(prev => prev.filter(s => s.id !== id));
      onToast?.('Speaker deleted', 'success');
      if (activeSpeaker?.id === id) onSelectSpeaker(null);
    } catch (err) { onToast?.(err.message, 'error'); }
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1>Speakers</h1>
        <p>Pick a speaker or create one, then record and review their samples</p>
      </div>

      <div style={{ marginBottom: 20 }}>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Speaker
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      ) : speakers.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <h3>No speakers yet</h3>
          <p>Add a speaker to start recording voice samples.</p>
        </div>
      ) : (
        <div className="card-grid">
          {speakers.map(s => (
            <div
              key={s.id}
              className="card"
              style={{
                cursor: 'pointer',
                borderColor: activeSpeaker?.id === s.id ? 'var(--accent)' : undefined,
                boxShadow: activeSpeaker?.id === s.id ? '0 0 0 1px var(--accent), 0 0 20px var(--accent-glow)' : undefined,
              }}
              onClick={() => onSelectSpeaker(s)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{s.name}</h3>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {isAdmin && s.owner_username && (
                      <span className="info" style={{ fontSize: 12, color: 'var(--accent)' }}>
                        Owner: {s.owner_name || s.owner_username} (@{s.owner_username})
                      </span>
                    )}
                    {s.age && <span className="info" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Age: {s.age}</span>}
                    {s.gender && <span className="info" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.gender}</span>}
                    {s.district && <span className="info" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.district}</span>}
                  </div>
                </div>
                <button
                  className="btn btn-danger btn-sm btn-icon"
                  style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                  onClick={(e) => { e.stopPropagation(); handleDeleteClick(s); }}
                  title="Delete"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
              {activeSpeaker?.id === s.id && (
                <div className="speaker-badge" style={{ marginTop: 12 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                  Selected
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Add Speaker</h2>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label>Name *</label>
                <input className="input" required value={form.name} onChange={e => setForm(p => ({...p, name: e.target.value}))} placeholder="Speaker name" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Age</label>
                  <input className="input" type="number" value={form.age} onChange={e => setForm(p => ({...p, age: e.target.value}))} placeholder="25" />
                </div>
                <div className="form-group">
                  <label>Gender</label>
                  <select className="input" value={form.gender} onChange={e => setForm(p => ({...p, gender: e.target.value}))}>
                    <option value="">Select</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>District</label>
                <input className="input" value={form.district} onChange={e => setForm(p => ({...p, district: e.target.value}))} placeholder="e.g. Ernakulam" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add Speaker</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmDelete.isOpen}
        title="Delete Speaker"
        message={`Are you sure you want to delete ${confirmDelete.name}? This will permanently remove the speaker and all of their recordings. This action cannot be undone.`}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete({ isOpen: false, id: null, name: '' })}
      />
    </div>
  );
}
