"""Indic Conformer ASR transcription wrapper (Malayalam RNNT)."""

import os

import soundfile as sf
import torch
import torchaudio
from transformers import AutoModel

MODEL_NAME = os.environ.get(
    "ASR_MODEL", "ai4bharat/indic-conformer-600m-multilingual"
)
HF_TOKEN = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
TARGET_SAMPLE_RATE = 16000
LANGUAGE = "ml"
DECODER = "rnnt"

_model = None


def get_model():
    """Lazy-load the Conformer model (heavy, only init once)."""
    global _model
    if _model is None:
        print(f"[transcriber] Loading model: {MODEL_NAME} ...")
        _model = AutoModel.from_pretrained(
            MODEL_NAME,
            trust_remote_code=True,
            token=HF_TOKEN,
        )
        print("[transcriber] Model loaded.")
    return _model


def _load_audio(audio_path: str) -> tuple[torch.Tensor, int]:
    """Load WAV audio as (channels, samples) float tensor."""
    data, sr = sf.read(audio_path, dtype="float32", always_2d=True)
    wav = torch.from_numpy(data.T)
    return wav, sr


def transcribe(audio_path: str) -> str:
    """Transcribe audio file and return the text."""
    wav, sr = _load_audio(audio_path)
    wav = torch.mean(wav, dim=0, keepdim=True)

    if sr != TARGET_SAMPLE_RATE:
        resampler = torchaudio.transforms.Resample(
            orig_freq=sr, new_freq=TARGET_SAMPLE_RATE
        )
        wav = resampler(wav)

    model = get_model()
    result = model(wav, LANGUAGE, DECODER)
    return result.strip()
