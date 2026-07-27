# Voice Collector

Malayalam TTS voice dataset collection app. Record audio, auto-transcribe with Whisper, review transcripts, and sync to Hugging Face.

## Quick Start (Development)

```bash
# Backend
cd backend
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Or use the launcher:

```bash
./run.sh
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000

## Docker Deployment (EC2)

### Requirements

- **Instance:** `t3.large` (2 vCPU, 8 GB RAM) recommended for CPU Whisper
- **Storage:** 50 GB gp3 EBS
- **OS:** Ubuntu 24.04 LTS
- **Port:** 80 (HTTP)

### Deploy

```bash
git clone <your-repo>
cd voice_collector
docker compose up -d --build
```

Access at `http://<ec2-public-ip>:8080`

Data persists in the `voice-data` Docker volume (SQLite DB + audio files).

### EC2 Setup

1. Launch `t3.large` with Ubuntu 24.04
2. Install Docker: `sudo apt update && sudo apt install -y docker.io docker-compose-v2`
3. Open security group: inbound TCP 8080 (or 80 if mapping directly)
4. Clone repo and run `docker compose up -d --build`

### Cost Estimate (ap-south-1)

| Resource | Monthly (24/7) |
|----------|----------------|
| t3.large | ~$60 |
| 50 GB gp3 | ~$4 |
| **Total** | **~$65** |

Stop the instance when not collecting to save ~70%.

## Dataset Rules

- **Target clip length:** 8–12 seconds (ideal)
- **Hard maximum:** 20 seconds
- **Minimum:** 3 seconds (shorter clips rejected)
- **Format:** 16 kHz mono WAV
- **Emotions:** neutral, happy, sad, angry, fearful, surprised, disgusted, calm

## Audio Processing

Recordings are enhanced server-side:
- Bandpass filter (80 Hz – 8 kHz)
- Noise reduction
- Loudness normalization (-23 LUFS)
- Silence trimming
- Duration enforcement

## HuggingFace Sync

1. Go to **Dataset** tab → **Settings**
2. Enter HF write token and dataset repo ID (e.g. `username/malayalam-tts`)
3. Accept recordings in Review queue
4. Click **Sync to HuggingFace**

Metadata CSV includes: `file_name`, `text`, `speaker_id`, `speaker_name`, `speaker_age`, `speaker_gender`, `speaker_district`, `duration`, `emotion`.

## Project Structure

```
voice_collector/
├── backend/          # FastAPI + Whisper + SQLite
│   ├── main.py
│   ├── db.py
│   ├── audio_processor.py
│   ├── transcriber.py
│   ├── hf_sync.py
│   └── pyproject.toml
├── frontend/         # React + Vite
├── Dockerfile
├── docker-compose.yml
└── run.sh
```
