import { useState, useRef } from 'react';
import { api, getToken } from '../utils/api';

/** Inline mini audio player with play/pause. */
export default function AudioPlayer({ recordingId, disabled = false }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef(null);
  const blobUrlRef = useRef(null);

  const ensureAudioSrc = async () => {
    const audio = audioRef.current;
    if (!audio || audio.src) return;

    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch(api.getAudioUrl(recordingId), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to load audio');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      audio.src = url;
    } finally {
      setLoading(false);
    }
  };

  const toggle = async () => {
    if (disabled || loading) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      try {
        await ensureAudioSrc();
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    }
  };

  return (
    <div className="audio-player">
      <audio
        ref={audioRef}
        onEnded={() => setPlaying(false)}
        onError={() => setPlaying(false)}
        preload="none"
      />
      <button
        className="play-btn"
        onClick={toggle}
        disabled={disabled || loading}
        title={disabled ? 'Audio not ready' : loading ? 'Loading...' : playing ? 'Pause' : 'Play'}
      >
        {loading ? (
          <span className="spinner" style={{ width: 14, height: 14 }} />
        ) : playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        )}
      </button>
    </div>
  );
}
