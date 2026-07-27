import { useState, useRef } from 'react';
import { api } from '../utils/api';

/** Inline mini audio player with play/pause. */
export default function AudioPlayer({ recordingId, disabled = false }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);

  const toggle = async () => {
    if (disabled) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      try {
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
        src={disabled ? undefined : api.getAudioUrl(recordingId)}
        onEnded={() => setPlaying(false)}
        onError={() => setPlaying(false)}
        preload="none"
      />
      <button
        className="play-btn"
        onClick={toggle}
        disabled={disabled}
        title={disabled ? 'Audio not ready' : playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        )}
      </button>
    </div>
  );
}
