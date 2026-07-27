"""FastAPI server for Voice Collector."""

import os
import uuid
import tempfile
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import db
import audio_processor
import transcriber
import hf_sync
from audio_processor import AudioTooShortError
from db import VALID_EMOTIONS

GOOGLE_INPUT_TOOLS_URL = (
    "https://inputtools.google.com/request?itc=ml-t-i0-und&num=5"
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    audio_processor.ensure_audio_dir()
    yield


app = FastAPI(title="Voice Collector API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic Models ────────────────────────────────────────────────────────

class SpeakerCreate(BaseModel):
    name: str
    age: int | None = None
    gender: str | None = None
    district: str | None = None


class RecordingUpdate(BaseModel):
    final_transcript: str | None = None
    status: str | None = None
    emotion: str | None = None


class SettingsUpdate(BaseModel):
    hf_token: str | None = None
    hf_repo: str | None = None


# ── Speaker Endpoints ──────────────────────────────────────────────────────

@app.get("/speakers")
def get_speakers():
    return db.list_speakers()


@app.post("/speakers")
def create_speaker(data: SpeakerCreate):
    return db.create_speaker(
        name=data.name, age=data.age, gender=data.gender, district=data.district
    )


@app.delete("/speakers/{speaker_id}")
def delete_speaker(speaker_id: str):
    if not db.delete_speaker(speaker_id):
        raise HTTPException(404, "Speaker not found")
    return {"ok": True}


# ── Recording Endpoints ────────────────────────────────────────────────────

def process_and_transcribe_bg(tmp_path: str, recording_id: int, output_name: str):
    try:
        audio_path, duration, quality = audio_processor.process_audio(tmp_path, output_name)
        transcript = transcriber.transcribe(audio_path)

        db.update_recording(
            recording_id,
            audio_path=audio_path,
            duration=duration,
            whisper_transcript=transcript,
            final_transcript=transcript,
            processing_status="ready",
            processing_error=None,
        )
    except AudioTooShortError as e:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        output_path = os.path.join(audio_processor.AUDIO_DIR, output_name)
        if os.path.exists(output_path):
            try:
                os.unlink(output_path)
            except OSError:
                pass
        db.update_recording(
            recording_id,
            processing_status="error",
            processing_error=str(e),
            duration=None,
        )
    except Exception as e:
        print(f"Error processing background recording {recording_id}: {e}")
        db.update_recording(
            recording_id,
            processing_status="error",
            processing_error=str(e),
            duration=None,
        )
    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@app.post("/recordings")
async def create_recording(
    background_tasks: BackgroundTasks,
    speaker_id: str = Form(...),
    audio: UploadFile = File(...),
    emotion: str = Form("neutral"),
):
    if not db.get_speaker(speaker_id):
        raise HTTPException(404, "Speaker not found")
    if emotion not in VALID_EMOTIONS:
        emotion = "neutral"

    suffix = os.path.splitext(audio.filename or "audio.webm")[1] or ".webm"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        content = await audio.read()
        tmp.write(content)
        tmp.close()

        output_name = f"{uuid.uuid4().hex[:12]}.wav"
        audio_path = os.path.join(audio_processor.AUDIO_DIR, output_name)

        recording = db.create_recording(
            speaker_id=speaker_id,
            audio_path=audio_path,
            whisper_transcript=None,
            duration=None,
            emotion=emotion,
        )

        background_tasks.add_task(
            process_and_transcribe_bg,
            tmp.name,
            recording["id"],
            output_name,
        )

        return recording

    except Exception as e:
        if os.path.exists(tmp.name):
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/recordings")
def get_recordings(
    status: str | None = Query(None),
    speaker_id: str | None = Query(None),
):
    return db.list_recordings(status=status, speaker_id=speaker_id)


@app.get("/recordings/count")
def get_recording_counts():
    return {
        "pending": db.count_recordings("pending"),
        "accepted": db.count_recordings("accepted"),
        "total": db.count_recordings(),
    }


@app.get("/recordings/{recording_id}")
def get_recording(recording_id: int):
    rec = db.get_recording(recording_id)
    if not rec:
        raise HTTPException(404, "Recording not found")
    return rec


@app.get("/recordings/{recording_id}/audio")
def get_recording_audio(recording_id: int):
    rec = db.get_recording(recording_id)
    if not rec:
        raise HTTPException(404, "Recording not found")
    if rec.get("processing_status") != "ready":
        raise HTTPException(404, "Audio not ready")
    if not os.path.exists(rec["audio_path"]):
        raise HTTPException(404, "Audio file not found")
    return FileResponse(rec["audio_path"], media_type="audio/wav")


@app.patch("/recordings/{recording_id}")
def update_recording(recording_id: int, data: RecordingUpdate):
    fields = {}
    if data.final_transcript is not None:
        fields["final_transcript"] = data.final_transcript
    if data.status is not None:
        if data.status not in ("pending", "accepted", "rejected"):
            raise HTTPException(400, "Invalid status")
        fields["status"] = data.status
    if data.emotion is not None:
        if data.emotion not in VALID_EMOTIONS:
            raise HTTPException(400, "Invalid emotion")
        fields["emotion"] = data.emotion
    rec = db.update_recording(recording_id, **fields)
    if not rec:
        raise HTTPException(404, "Recording not found")
    return rec


@app.delete("/recordings/{recording_id}")
def delete_recording(recording_id: int):
    if not db.delete_recording(recording_id):
        raise HTTPException(404, "Recording not found")
    return {"ok": True}


# ── Transliteration ────────────────────────────────────────────────────────

@app.get("/transliterate")
async def transliterate(q: str = Query(..., min_length=1)):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(GOOGLE_INPUT_TOOLS_URL, params={"text": q})
            data = res.json()
        if data[0] == "SUCCESS" and data[1] and data[1][0] and data[1][0][1]:
            return {"suggestions": data[1][0][1]}
        return {"suggestions": []}
    except Exception:
        return {"suggestions": []}


# ── Settings Endpoints ─────────────────────────────────────────────────────

@app.get("/settings")
def get_settings():
    settings = db.get_all_settings()
    token = settings.pop("hf_token", None)
    if token:
        settings["hf_token_masked"] = (
            token[:4] + "****" + token[-4:] if len(token) > 8 else "****"
        )
    return settings


@app.put("/settings")
def update_settings(data: SettingsUpdate):
    if data.hf_token is not None:
        db.set_setting("hf_token", data.hf_token)
    if data.hf_repo is not None:
        db.set_setting("hf_repo", data.hf_repo)
    return {"ok": True}


# ── Sync Endpoint ──────────────────────────────────────────────────────────

@app.post("/sync")
def sync_to_hub():
    result = hf_sync.sync_to_hub()
    if not result["success"]:
        raise HTTPException(400, result["error"])
    return result
