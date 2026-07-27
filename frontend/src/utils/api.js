const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const TOKEN_KEY = 'voice_collector_token';

const EMOTIONS = [
  'neutral', 'happy', 'sad', 'angry', 'fearful', 'surprised', 'disgusted', 'calm',
];

let onUnauthorized = null;

function formatError(detail) {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(d => d.msg || JSON.stringify(d)).join(', ');
  if (detail && typeof detail === 'object') return detail.message || JSON.stringify(detail);
  return 'Request failed';
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function setOnUnauthorized(callback) {
  onUnauthorized = callback;
}

async function request(path, options = {}) {
  const headers = { ...options.headers };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    setToken(null);
    onUnauthorized?.();
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(formatError(err.detail));
  }
  return res.json();
}

export { EMOTIONS };

export const api = {
  // Auth
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  signup: (name, username, password) =>
    request('/auth/signup', { method: 'POST', body: JSON.stringify({ name, username, password }) }),
  getMe: () => request('/auth/me'),

  // Speakers
  getSpeakers: () => request('/speakers'),
  createSpeaker: (data) => request('/speakers', { method: 'POST', body: JSON.stringify(data) }),
  updateSpeaker: (id, data) => request(`/speakers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSpeaker: (id) => request(`/speakers/${id}`, { method: 'DELETE' }),

  // Recordings
  uploadRecording: (speakerId, audioBlob, emotion = 'neutral') => {
    const form = new FormData();
    form.append('speaker_id', speakerId);
    form.append('audio', audioBlob, 'recording.webm');
    form.append('emotion', emotion);
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${API_BASE}/recordings`, { method: 'POST', body: form, headers }).then(async (r) => {
      if (r.status === 401) {
        setToken(null);
        onUnauthorized?.();
        throw new Error('Session expired. Please log in again.');
      }
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
  getRecordingCounts: (speakerId) => {
    const qs = speakerId ? `?speaker_id=${encodeURIComponent(speakerId)}` : '';
    return request(`/recordings/count${qs}`);
  },
  updateRecording: (id, data) => request(`/recordings/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRecording: (id) => request(`/recordings/${id}`, { method: 'DELETE' }),
  getAudioUrl: (id) => `${API_BASE}/recordings/${id}/audio`,

  // Transliteration
  transliterate: (word) => request(`/transliterate?q=${encodeURIComponent(word)}`),

  // Settings
  getSettings: () => request('/settings'),
  updateSettings: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Sync
  syncToHub: (speakerId) => request('/sync', { method: 'POST', body: JSON.stringify({ speaker_id: speakerId }) }),
};
