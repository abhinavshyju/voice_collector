import { useState, useRef, useCallback, useEffect } from 'react';
import { api, EMOTIONS } from '../utils/api';
import WaveformVisualizer from '../components/WaveformVisualizer';

const HARD_MIN = 3;
const IDEAL_MIN = 8;
const IDEAL_MAX = 12;
const HARD_MAX = 20;

function getMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function getTimerClass(elapsed) {
  if (elapsed < HARD_MIN) return 'timer-gray';
  if (elapsed < IDEAL_MIN) return 'timer-yellow';
  if (elapsed <= IDEAL_MAX) return 'timer-green';
  if (elapsed < HARD_MAX) return 'timer-yellow';
  return 'timer-red';
}

function getTimerHint(elapsed) {
  if (elapsed < HARD_MIN) return 'Keep going — min 3 sec';
  if (elapsed < IDEAL_MIN) return 'OK — aim for 8–12 sec';
  if (elapsed <= IDEAL_MAX) return 'Perfect range!';
  if (elapsed < HARD_MAX) return 'Stop soon — max 20 sec';
  return 'Max reached';
}

export default function RecorderPage({ activeSpeaker, onToast, onCountUpdate }) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [emotion, setEmotion] = useState('neutral');
  const [stream, setStream] = useState(null);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const streamRef = useRef(null);
  const elapsedRef = useRef(0);

  // Cleanup stream on unmount only
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Timer lifecycle tied to recording state
  useEffect(() => {
    if (!recording) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startTimeRef.current) / 1000);
      elapsedRef.current = secs;
      setElapsed(secs);

      if (secs >= HARD_MAX) {
        if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
          mediaRecorder.current.stop();
        }
      }
    }, 200);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [recording]);

  const startRecording = useCallback(async () => {
    try {
      const mimeType = getMimeType();
      if (!mimeType) {
        onToast('Recording not supported in this browser', 'error');
        return;
      }

      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = s;
      setStream(s);

      const recorder = new MediaRecorder(s, { mimeType });
      mediaRecorder.current = recorder;
      chunks.current = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
      recorder.onstop = async () => {
        const recordedSecs = elapsedRef.current;
        s.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setStream(null);
        setRecording(false);
        setElapsed(0);
        elapsedRef.current = 0;

        if (recordedSecs < HARD_MIN) {
          onToast('Too short — minimum 3 seconds', 'error');
          return;
        }

        const blob = new Blob(chunks.current, { type: mimeType });

        setUploading(true);
        try {
          await api.uploadRecording(activeSpeaker.id, blob, emotion);
          onToast('Uploaded — transcribing in background', 'success');
          onCountUpdate?.();
        } catch (err) {
          onToast('Upload failed: ' + err.message, 'error');
        }
        setUploading(false);
      };

      recorder.start(100);
      startTimeRef.current = Date.now();
      elapsedRef.current = 0;
      setElapsed(0);
      setRecording(true);
    } catch {
      onToast('Microphone access denied', 'error');
    }
  }, [activeSpeaker, emotion, onToast, onCountUpdate]);

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop();
    }
  }, []);

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!activeSpeaker) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <h1>Record</h1>
          <p>Capture voice samples</p>
        </div>
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          <h3>No speaker selected</h3>
          <p>Go to the Speakers tab and select a speaker first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1>Record</h1>
        <p>Capture voice samples</p>
        <div className="speaker-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          {activeSpeaker.name}
        </div>
      </div>

      <div className="record-area">
        <div className="form-group" style={{ maxWidth: 220, margin: '0 auto 16px' }}>
          <label>Emotion</label>
          <select
            className="input"
            value={emotion}
            onChange={e => setEmotion(e.target.value)}
            disabled={recording || uploading}
          >
            {EMOTIONS.map(e => (
              <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
            ))}
          </select>
        </div>

        <div className={`record-timer ${getTimerClass(elapsed)}`}>{formatTime(elapsed)}</div>
        <p className="timer-hint">{getTimerHint(elapsed)}</p>
        <p className="timer-target">Min: 3 sec · Target: 8–12 sec · Max: 20 sec</p>

        <WaveformVisualizer stream={stream} />

        <button
          className={`record-btn ${recording ? 'recording' : ''}`}
          onClick={recording ? stopRecording : startRecording}
          disabled={uploading}
          title={recording ? 'Stop Recording' : 'Start Recording'}
        >
          {recording ? (
            <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
          )}
        </button>

        <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
          {uploading ? 'Uploading...' : recording ? 'Tap to stop' : 'Tap to start recording'}
        </p>

        {uploading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)', fontSize: 13 }}>
            <span className="spinner" />
            Uploading clip...
          </div>
        )}
      </div>
    </div>
  );
}
