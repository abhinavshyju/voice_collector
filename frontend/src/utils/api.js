const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const EMOTIONS = [
  'neutral', 'happy', 'sad', 'angry', 'fearful', 'surprised', 'disgusted', 'calm',
];

function formatError(detail) {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(d => d.msg || JSON.stringify(d)).join(', ');
  if (detail && typeof detail === 'object') return detail.message || JSON.stringify(detail);
  return 'Request failed';
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(formatError(err.detail));
  }
  return res.json();
}

export { EMOTIONS };

export const api = {
  // Speakers
  getSpeakers: () => request('/speakers'),
  createSpeaker: (data) => request('/speakers', { method: 'POST', body: JSON.stringify(data) }),
  deleteSpeaker: (id) => request(`/speakers/${id}`, { method: 'DELETE' }),

  // Recordings
  uploadRecording: (speakerId, audioBlob, emotion = 'neutral') => {
    const form = new FormData();
    form.append('speaker_id', speakerId);
    form.append('audio', audioBlob, 'recording.webm');
    form.append('emotion', emotion);
    return fetch(`${API_BASE}/recordings`, { method: 'POST', body: form }).then(async (r) => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }));
        throw new Error(formatError(err.detail) || 'Upload failed');
      }
      return r.json();
    });
  },
  getRecordings: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/recordings${qs ? '?' + qs : ''}`);
  },
  getRecordingCounts: () => request('/recordings/count'),
  updateRecording: (id, data) => request(`/recordings/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRecording: (id) => request(`/recordings/${id}`, { method: 'DELETE' }),
  getAudioUrl: (id) => `${API_BASE}/recordings/${id}/audio`,

  // Transliteration
  transliterate: (word) => request(`/transliterate?q=${encodeURIComponent(word)}`),

  // Settings
  getSettings: () => request('/settings'),
  updateSettings: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Sync
  syncToHub: () => request('/sync', { method: 'POST' }),
};
