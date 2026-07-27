import { useState, useRef, useCallback, useEffect } from 'react';
import { api, EMOTIONS } from '../utils/api';
import WaveformVisualizer from '../components/WaveformVisualizer';

const HARD_MIN = 3;
const IDEAL_MIN = 8;
const IDEAL_MAX = 12;
const HARD_MAX = 20;
const MAX_EXCLUDE = 5;

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
  const [promptText, setPromptText] = useState('');
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [promptError, setPromptError] = useState(null);
  const [recentPrompts, setRecentPrompts] = useState([]);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const streamRef = useRef(null);
  const elapsedRef = useRef(0);
  const emotionRef = useRef(emotion);
  const recentPromptsRef = useRef(recentPrompts);
  const fetchPromptRef = useRef(null);

  emotionRef.current = emotion;
  recentPromptsRef.current = recentPrompts;

  const fetchPrompt = useCallback(async () => {
    setLoadingPrompt(true);
    setPromptError(null);
    try {
      const { text } = await api.getNextPrompt(emotionRef.current, recentPromptsRef.current);
      setPromptText(text);
      setRecentPrompts(prev => [text, ...prev].slice(0, MAX_EXCLUDE));
    } catch (err) {
      setPromptError(err.message);
    } finally {
      setLoadingPrompt(false);
    }
  }, []);

  fetchPromptRef.current = fetchPrompt;

  // Cleanup stream on unmount only
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Fetch prompt on mount and when emotion changes
  useEffect(() => {
    if (activeSpeaker) {
      fetchPromptRef.current?.();
    }
  }, [activeSpeaker?.id, emotion]);

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

  const beginRecording = useCallback(async () => {
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
        await api.uploadRecording(activeSpeaker.id, blob, emotionRef.current);
        onToast('Uploaded — transcribing in background', 'success');
        onCountUpdate?.();
        fetchPromptRef.current?.();
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
  }, [activeSpeaker, onToast, onCountUpdate]);

  const startRecording = useCallback(async () => {
    try {
      if (!promptText && !loadingPrompt) {
        await fetchPrompt();
      }
      await beginRecording();
    } catch (err) {
      const needsHttps = !window.isSecureContext;
      onToast(
        needsHttps
          ? 'Microphone needs HTTPS — open https://' + window.location.host
          : 'Microphone access denied — allow mic in browser settings',
        'error'
      );
    }
  }, [promptText, loadingPrompt, fetchPrompt, beginRecording, onToast]);

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
    return null;
  }

  const promptBusy = loadingPrompt || recording || uploading;

  return (
    <div className="fade-in recorder-page">
      <div className="page-header">
        <h1>Record</h1>
        <p>Capture voice samples for {activeSpeaker.name}</p>
      </div>

      <div className="record-area">
        <div className="prompt-card">
          <div className="prompt-card-header">
            <span className="prompt-card-label">Read this aloud</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm prompt-refresh-btn"
              onClick={fetchPrompt}
              disabled={promptBusy}
              title="New sentence"
              aria-label="New sentence"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
            </button>
          </div>
          {loadingPrompt ? (
            <div className="prompt-card-loading">
              <span className="spinner" />
              <span>Loading sentence...</span>
            </div>
          ) : promptError ? (
            <div className="prompt-card-error">
              <p>{promptError}</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={fetchPrompt} disabled={promptBusy}>
                Retry
              </button>
            </div>
          ) : (
            <p className="prompt-card-text">{promptText}</p>
          )}
        </div>

        <div className="form-group emotion-select-group">
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

        <div className="timer-section">
          <div className={`record-timer ${getTimerClass(elapsed)}`}>{formatTime(elapsed)}</div>
          <p className="timer-hint">{getTimerHint(elapsed)}</p>
          <p className="timer-target">Min: 3 sec · Target: 8–12 sec · Max: 20 sec</p>
        </div>

        <WaveformVisualizer stream={stream} />

        <div className="record-controls-group">
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

          <p className="record-status-text">
            {uploading ? 'Uploading...' : recording ? 'Tap to stop' : 'Tap to start recording'}
          </p>

          {uploading && (
            <div className="upload-spinner-wrap">
              <span className="spinner" />
              Uploading clip...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
