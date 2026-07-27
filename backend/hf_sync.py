"""Hugging Face Hub dataset synchronization."""

import csv
import os
from huggingface_hub import HfApi

from db import list_recordings, get_all_settings, mark_recordings_synced

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
METADATA_PATH = os.path.join(DATA_DIR, "metadata.csv")
README_PATH = os.path.join(DATA_DIR, "README.md")

MIN_DURATION_S = 3.0


def _eligible_recordings() -> list[dict]:
    """Accepted recordings that meet duration requirements."""
    recordings = list_recordings(status="accepted")
    return [
        r for r in recordings
        if r.get("duration") is not None and r["duration"] >= MIN_DURATION_S
    ]


def generate_metadata_csv(recordings: list[dict]) -> str:
    """Generate metadata.csv from accepted recordings."""
    os.makedirs(DATA_DIR, exist_ok=True)

    with open(METADATA_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "file_name", "text", "speaker_id", "speaker_name",
            "speaker_age", "speaker_gender", "speaker_district",
            "duration", "emotion",
        ])

        for rec in recordings:
            audio_basename = os.path.basename(rec["audio_path"])
            transcript = rec["final_transcript"] or rec["whisper_transcript"] or ""

            writer.writerow([
                f"audio/{audio_basename}",
                transcript,
                rec["speaker_id"],
                rec.get("speaker_name", "unknown"),
                rec.get("speaker_age", ""),
                rec.get("speaker_gender", ""),
                rec.get("speaker_district", ""),
                rec["duration"],
                rec.get("emotion", "neutral"),
            ])

    return METADATA_PATH


def generate_readme(recordings: list[dict], repo_id: str) -> str:
    speakers = {r["speaker_id"] for r in recordings}
    emotions = sorted({r.get("emotion", "neutral") for r in recordings})
    content = f"""---
license: mit
task_categories:
  - text-to-speech
language:
  - ml
tags:
  - malayalam
  - tts
  - speech-synthesis
size_categories:
  - n<1K
---

# {repo_id}

Malayalam TTS voice dataset collected via Voice Collector.

## Dataset Summary

- **Recordings:** {len(recordings)}
- **Speakers:** {len(speakers)}
- **Emotions:** {', '.join(emotions)}
- **Target clip length:** 8–12 seconds (max 20s)
- **Audio format:** 16 kHz mono WAV

## Columns

| Column | Description |
|--------|-------------|
| `file_name` | Path to audio file |
| `text` | Malayalam transcript |
| `speaker_id` | Unique speaker identifier |
| `speaker_name` | Speaker display name |
| `speaker_age` | Speaker age |
| `speaker_gender` | Speaker gender |
| `speaker_district` | Speaker district |
| `duration` | Clip duration in seconds |
| `emotion` | Emotional tone of the recording |

## Usage

```python
from datasets import load_dataset
ds = load_dataset("{repo_id}")
```
"""
    with open(README_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    return README_PATH


def sync_to_hub() -> dict:
    """Sync accepted recordings to a HuggingFace dataset repository."""
    settings = get_all_settings()
    hf_token = settings.get("hf_token")
    hf_repo = settings.get("hf_repo")

    if not hf_token or not hf_repo:
        return {"success": False, "error": "HuggingFace token or repo ID not configured."}

    recordings = _eligible_recordings()
    if not recordings:
        return {"success": False, "error": "No accepted recordings (3s+) to sync."}

    try:
        generate_metadata_csv(recordings)
        generate_readme(recordings, hf_repo)

        api = HfApi(token=hf_token)
        api.create_repo(repo_id=hf_repo, repo_type="dataset", exist_ok=True)

        api.upload_file(
            path_or_fileobj=METADATA_PATH,
            path_in_repo="metadata.csv",
            repo_id=hf_repo,
            repo_type="dataset",
        )

        api.upload_file(
            path_or_fileobj=README_PATH,
            path_in_repo="README.md",
            repo_id=hf_repo,
            repo_type="dataset",
        )

        for rec in recordings:
            audio_path = rec["audio_path"]
            if not os.path.isfile(audio_path):
                continue
            api.upload_file(
                path_or_fileobj=audio_path,
                path_in_repo=f"audio/{os.path.basename(audio_path)}",
                repo_id=hf_repo,
                repo_type="dataset",
            )

        mark_recordings_synced([r["id"] for r in recordings])

        return {
            "success": True,
            "recordings_synced": len(recordings),
            "repo": hf_repo,
        }

    except Exception as e:
        return {"success": False, "error": str(e)}
