"""FastAPI server for Voice Collector."""

import os
import uuid
import tempfile
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, field_validator

import db
import auth
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

class SignupRequest(BaseModel):
    name: str
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_min_length(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("Username must be at least 3 characters")
        return v

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    username: str
    password: str


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


def _ctx(current_user: dict) -> dict:
    return auth.user_context(current_user)


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True}


# ── Auth Endpoints ───────────────────────────────────────────────────────────

@app.post("/auth/signup")
def signup(data: SignupRequest):
    try:
        user = db.create_user(
            name=data.name.strip(),
            username=data.username.strip(),
            password_hash=auth.hash_password(data.password),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    token = auth.create_access_token(user["id"], bool(user.get("is_admin")))
    return {"token": token, "user": auth._user_public(user)}


@app.post("/auth/login")
def login(data: LoginRequest):
    user = db.get_user_by_username(data.username.strip())
    if not user or not auth.verify_password(data.password, user["password_hash"]):
        raise HTTPException(401, "Invalid username or password")
    token = auth.create_access_token(user["id"], bool(user.get("is_admin")))
    return {"token": token, "user": auth._user_public(user)}


@app.get("/auth/me")
def get_me(current_user: dict = Depends(auth.get_current_user)):
    return auth._user_public(current_user)


# ── Speaker Endpoints ──────────────────────────────────────────────────────

@app.get("/speakers")
def get_speakers(current_user: dict = Depends(auth.get_current_user)):
    ctx = _ctx(current_user)
    return db.list_speakers(user_id=ctx["user_id"], is_admin=ctx["is_admin"])


@app.post("/speakers")
def create_speaker(data: SpeakerCreate, current_user: dict = Depends(auth.get_current_user)):
    ctx = _ctx(current_user)
    return db.create_speaker(
        name=data.name,
        user_id=ctx["user_id"],
        age=data.age,
        gender=data.gender,
        district=data.district,
    )


@app.delete("/speakers/{speaker_id}")
def delete_speaker(speaker_id: str, current_user: dict = Depends(auth.get_current_user)):
    ctx = _ctx(current_user)
    if not db.delete_speaker(speaker_id, user_id=ctx["user_id"], is_admin=ctx["is_admin"]):
        raise HTTPException(404, "Speaker not found")
    return {"ok": True}


# ── Recording Endpoints ────────────────────────────────────────────────────

def process_and_transcribe_bg(tmp_path: str, recording_id: int, output_name: str):
    try:
        audio_path, duration, quality = audio_processor.process_audio(tmp_path, output_name)
        transcript = transcriber.transcribe(audio_path)

        db.update_recording(
            recording_id,
            _internal=True,
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
            _internal=True,
            processing_status="error",
            processing_error=str(e),
            duration=None,
        )
    except Exception as e:
        print(f"Error processing background recording {recording_id}: {e}")
        db.update_recording(
            recording_id,
            _internal=True,
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
    current_user: dict = Depends(auth.get_current_user),
):
    ctx = _ctx(current_user)
    if not db.get_speaker(speaker_id, user_id=ctx["user_id"], is_admin=ctx["is_admin"]):
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
    current_user: dict = Depends(auth.get_current_user),
):
    ctx = _ctx(current_user)
    return db.list_recordings(
        status=status,
        speaker_id=speaker_id,
        user_id=ctx["user_id"],
        is_admin=ctx["is_admin"],
    )


@app.get("/recordings/count")
def get_recording_counts(current_user: dict = Depends(auth.get_current_user)):
    ctx = _ctx(current_user)
    return {
        "pending": db.count_recordings("pending", user_id=ctx["user_id"], is_admin=ctx["is_admin"]),
        "accepted": db.count_recordings("accepted", user_id=ctx["user_id"], is_admin=ctx["is_admin"]),
        "total": db.count_recordings(user_id=ctx["user_id"], is_admin=ctx["is_admin"]),
    }


@app.get("/recordings/{recording_id}")
def get_recording(recording_id: int, current_user: dict = Depends(auth.get_current_user)):
    ctx = _ctx(current_user)
    rec = db.get_recording(recording_id, user_id=ctx["user_id"], is_admin=ctx["is_admin"])
    if not rec:
        raise HTTPException(404, "Recording not found")
    return rec


@app.get("/recordings/{recording_id}/audio")
def get_recording_audio(recording_id: int, current_user: dict = Depends(auth.get_current_user)):
    ctx = _ctx(current_user)
    rec = db.get_recording(recording_id, user_id=ctx["user_id"], is_admin=ctx["is_admin"])
    if not rec:
        raise HTTPException(404, "Recording not found")
    if rec.get("processing_status") != "ready":
        raise HTTPException(404, "Audio not ready")
    if not os.path.exists(rec["audio_path"]):
        raise HTTPException(404, "Audio file not found")
    return FileResponse(rec["audio_path"], media_type="audio/wav")


@app.patch("/recordings/{recording_id}")
def update_recording(
    recording_id: int,
    data: RecordingUpdate,
    current_user: dict = Depends(auth.get_current_user),
):
    ctx = _ctx(current_user)
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
    rec = db.update_recording(
        recording_id, user_id=ctx["user_id"], is_admin=ctx["is_admin"], **fields
    )
    if not rec:
        raise HTTPException(404, "Recording not found")
    return rec


@app.delete("/recordings/{recording_id}")
def delete_recording(recording_id: int, current_user: dict = Depends(auth.get_current_user)):
    ctx = _ctx(current_user)
    if not db.delete_recording(recording_id, user_id=ctx["user_id"], is_admin=ctx["is_admin"]):
        raise HTTPException(404, "Recording not found")
    return {"ok": True}


# ── Transliteration ────────────────────────────────────────────────────────

@app.get("/transliterate")
async def transliterate(
    q: str = Query(..., min_length=1),
    current_user: dict = Depends(auth.get_current_user),
):
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
def get_settings(current_user: dict = Depends(auth.require_admin)):
    settings = db.get_all_settings()
    token = settings.pop("hf_token", None)
    if token:
        settings["hf_token_masked"] = (
            token[:4] + "****" + token[-4:] if len(token) > 8 else "****"
        )
    return settings


@app.put("/settings")
def update_settings(data: SettingsUpdate, current_user: dict = Depends(auth.require_admin)):
    if data.hf_token is not None:
        db.set_setting("hf_token", data.hf_token)
    if data.hf_repo is not None:
        db.set_setting("hf_repo", data.hf_repo)
    return {"ok": True}


# ── Sync Endpoint ──────────────────────────────────────────────────────────

@app.post("/sync")
def sync_to_hub(current_user: dict = Depends(auth.require_admin)):
    result = hf_sync.sync_to_hub()
    if not result["success"]:
        raise HTTPException(400, result["error"])
    return result
