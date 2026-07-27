"""Audio processing: format conversion, enhancement, silence trimming, duration enforcement."""

import os
import numpy as np
from pydub import AudioSegment
from pydub.silence import detect_silence

AUDIO_DIR = os.path.join(os.path.dirname(__file__), "data", "audio")

# Processing constants
TARGET_SAMPLE_RATE = 16000
TARGET_CHANNELS = 1
TARGET_SAMPLE_WIDTH = 2  # 16-bit
TARGET_LUFS = -23.0

# Silence detection
SILENCE_THRESH_DB = -40
MIN_SILENCE_LEN_MS = 400
TRIM_PADDING_MS = 200

# Duration rules
HARD_MIN_S = 3
IDEAL_MIN_S = 8
IDEAL_MAX_S = 12
HARD_MAX_S = 20


class AudioTooShortError(Exception):
    """Raised when audio is shorter than the minimum required duration."""


class AudioProcessingError(Exception):
    """Raised for general audio processing failures."""


def ensure_audio_dir():
    os.makedirs(AUDIO_DIR, exist_ok=True)


def _segment_to_numpy(audio: AudioSegment) -> np.ndarray:
    samples = np.array(audio.get_array_of_samples(), dtype=np.float32)
    if audio.channels > 1:
        samples = samples.reshape((-1, audio.channels)).mean(axis=1)
    max_val = float(2 ** (8 * audio.sample_width - 1))
    return samples / max_val


def _numpy_to_segment(samples: np.ndarray, sample_rate: int) -> AudioSegment:
    samples = np.clip(samples, -1.0, 1.0)
    int_samples = (samples * 32767).astype(np.int16)
    return AudioSegment(
        int_samples.tobytes(),
        frame_rate=sample_rate,
        sample_width=2,
        channels=1,
    )


def _apply_bandpass(audio: AudioSegment) -> AudioSegment:
    """Remove rumble and high-frequency noise."""
    return audio.high_pass_filter(80).low_pass_filter(8000)


def _reduce_noise(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    try:
        import noisereduce as nr
        noise_len = min(int(sample_rate * 0.3), len(samples) // 4)
        if noise_len > 0:
            noise_clip = samples[:noise_len]
            return nr.reduce_noise(y=samples, sr=sample_rate, y_noise=noise_clip, stationary=True)
        return nr.reduce_noise(y=samples, sr=sample_rate, stationary=True)
    except Exception:
        return samples


def _normalize_loudness(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    try:
        import pyloudnorm as pyln
        meter = pyln.Meter(sample_rate)
        loudness = meter.integrated_loudness(samples)
        if np.isfinite(loudness):
            samples = pyln.normalize.loudness(samples, loudness, TARGET_LUFS)
    except Exception:
        rms = np.sqrt(np.mean(samples ** 2))
        if rms > 0:
            target_rms = 10 ** (TARGET_LUFS / 20) * 0.1
            samples = samples * (target_rms / rms)
    return samples


def _apply_limiter(samples: np.ndarray, ceiling: float = 0.89) -> np.ndarray:
    """Soft peak limiter at roughly -1 dBFS."""
    peak = np.max(np.abs(samples))
    if peak > ceiling:
        samples = samples * (ceiling / peak)
    return samples


def _compute_audio_quality(samples: np.ndarray) -> dict:
    peak_db = 20 * np.log10(max(np.max(np.abs(samples)), 1e-10))
    rms = np.sqrt(np.mean(samples ** 2))
    rms_db = 20 * np.log10(max(rms, 1e-10))
    return {
        "peak_db": round(float(peak_db), 1),
        "rms_db": round(float(rms_db), 1),
        "clipping_warning": peak_db > -0.5,
        "quiet_warning": rms_db < -35,
    }


def process_audio(input_path: str, output_filename: str) -> tuple[str, float, dict]:
    """
    Process an uploaded audio file:
    1. Convert to 16kHz mono 16-bit WAV
    2. Bandpass filter, noise reduction, loudness normalization
    3. Trim leading and trailing silence
    4. Enforce duration rules (8-12s ideal, 20s max)

    Returns (output_path, duration_seconds, quality_info).
    """
    ensure_audio_dir()

    audio = AudioSegment.from_file(input_path)
    audio = audio.set_frame_rate(TARGET_SAMPLE_RATE)
    audio = audio.set_channels(TARGET_CHANNELS)
    audio = audio.set_sample_width(TARGET_SAMPLE_WIDTH)

    audio = _apply_bandpass(audio)
    samples = _segment_to_numpy(audio)
    samples = _reduce_noise(samples, TARGET_SAMPLE_RATE)
    samples = _normalize_loudness(samples, TARGET_SAMPLE_RATE)
    samples = _apply_limiter(samples)
    audio = _numpy_to_segment(samples, TARGET_SAMPLE_RATE)

    audio = _trim_silence(audio)
    audio = _enforce_duration(audio)

    duration_s = len(audio) / 1000.0
    if duration_s < HARD_MIN_S:
        raise AudioTooShortError(
            f"Clip too short ({duration_s:.1f}s) — minimum {HARD_MIN_S} seconds"
        )

    quality = _compute_audio_quality(_segment_to_numpy(audio))

    output_path = os.path.join(AUDIO_DIR, output_filename)
    audio.export(output_path, format="wav")

    return output_path, duration_s, quality


def _trim_silence(audio: AudioSegment) -> AudioSegment:
    """Remove leading and trailing silence, keeping a small padding buffer."""
    silent_ranges = detect_silence(
        audio,
        min_silence_len=MIN_SILENCE_LEN_MS,
        silence_thresh=SILENCE_THRESH_DB,
    )

    if not silent_ranges:
        return audio

    total_len = len(audio)
    speech_start = 0
    if silent_ranges[0][0] <= 50:
        speech_start = max(0, silent_ranges[0][1] - TRIM_PADDING_MS)

    speech_end = total_len
    if silent_ranges[-1][1] >= total_len - 50:
        speech_end = min(total_len, silent_ranges[-1][0] + TRIM_PADDING_MS)

    if speech_start >= speech_end:
        return audio

    return audio[speech_start:speech_end]


def _enforce_duration(audio: AudioSegment) -> AudioSegment:
    """
    Enforce duration rules:
    - 8-12s: keep as-is (ideal range)
    - 12-20s: find first natural pause after 8s mark and cut there
    - > 20s: hard cut at 20s
    """
    duration_ms = len(audio)
    ideal_max_ms = IDEAL_MAX_S * 1000
    hard_max_ms = HARD_MAX_S * 1000
    search_start_ms = IDEAL_MIN_S * 1000

    if duration_ms <= ideal_max_ms:
        return audio

    silent_ranges = detect_silence(
        audio,
        min_silence_len=MIN_SILENCE_LEN_MS,
        silence_thresh=SILENCE_THRESH_DB,
    )

    for start_ms, end_ms in silent_ranges:
        if start_ms >= search_start_ms:
            cut_point = (start_ms + end_ms) // 2
            if cut_point <= hard_max_ms:
                return audio[:cut_point]

    return audio[:hard_max_ms]
