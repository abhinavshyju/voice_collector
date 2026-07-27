"""Whisper ASR transcription wrapper."""

import os
from transformers import pipeline

MODEL_NAME = os.environ.get("WHISPER_MODEL", "abhinav-spidey/Whisper-ml-v1")

_pipe = None


def get_pipeline():
    """Lazy-load the Whisper pipeline (heavy, only init once)."""
    global _pipe
    if _pipe is None:
        print(f"[transcriber] Loading model: {MODEL_NAME} ...")
        _pipe = pipeline(
            "automatic-speech-recognition",
            model=MODEL_NAME,
            chunk_length_s=30,
        )
        print("[transcriber] Model loaded.")
    return _pipe


def transcribe(audio_path: str) -> str:
    """Transcribe audio file and return the text."""
    pipe = get_pipeline()
    result = pipe(audio_path)
    return result["text"].strip()
