"""SQLite database management for Voice Collector."""

import sqlite3
import uuid
import os
from datetime import datetime, timezone

DB_DIR = os.path.join(os.path.dirname(__file__), "data")
DB_PATH = os.path.join(DB_DIR, "voice_collector.db")

VALID_EMOTIONS = frozenset({
    "neutral", "happy", "sad", "angry", "fearful", "surprised", "disgusted", "calm",
})


def get_connection() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r["name"] == column for r in rows)


def _migrate(conn: sqlite3.Connection):
    """Add columns introduced after initial schema."""
    migrations = [
        ("recordings", "processing_status", "TEXT NOT NULL DEFAULT 'pending'"),
        ("recordings", "processing_error", "TEXT"),
        ("recordings", "emotion", "TEXT NOT NULL DEFAULT 'neutral'"),
        ("recordings", "synced_at", "TEXT"),
    ]
    for table, column, col_type in migrations:
        if not _column_exists(conn, table, column):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")

    # Backfill processing_status for existing rows
    conn.execute("""
        UPDATE recordings
        SET processing_status = CASE
            WHEN whisper_transcript LIKE '[Processing Error:%' THEN 'error'
            WHEN duration IS NOT NULL THEN 'ready'
            ELSE 'pending'
        END
    """)


def init_db():
    """Create tables if they don't exist."""
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS speakers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            age INTEGER,
            gender TEXT,
            district TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS recordings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            speaker_id TEXT NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
            audio_path TEXT NOT NULL,
            whisper_transcript TEXT,
            final_transcript TEXT,
            duration REAL,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
        CREATE INDEX IF NOT EXISTS idx_recordings_speaker ON recordings(speaker_id);

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    """)
    _migrate(conn)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_recordings_processing ON recordings(processing_status)
    """)
    conn.commit()
    conn.close()


def _recording_row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


# ── Speaker CRUD ────────────────────────────────────────────────────────────

def create_speaker(name: str, age: int = None, gender: str = None, district: str = None) -> dict:
    conn = get_connection()
    speaker_id = str(uuid.uuid4())[:8]
    conn.execute(
        "INSERT INTO speakers (id, name, age, gender, district) VALUES (?, ?, ?, ?, ?)",
        (speaker_id, name, age, gender, district),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM speakers WHERE id = ?", (speaker_id,)).fetchone()
    conn.close()
    return dict(row)


def list_speakers() -> list[dict]:
    conn = get_connection()
    rows = conn.execute("SELECT * FROM speakers ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_speaker(speaker_id: str) -> dict | None:
    conn = get_connection()
    row = conn.execute("SELECT * FROM speakers WHERE id = ?", (speaker_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def delete_speaker(speaker_id: str) -> bool:
    conn = get_connection()
    rows = conn.execute(
        "SELECT audio_path FROM recordings WHERE speaker_id = ?", (speaker_id,)
    ).fetchall()
    for row in rows:
        if row["audio_path"] and os.path.exists(row["audio_path"]):
            try:
                os.remove(row["audio_path"])
            except OSError:
                pass
    cur = conn.execute("DELETE FROM speakers WHERE id = ?", (speaker_id,))
    conn.commit()
    conn.close()
    return cur.rowcount > 0


# ── Recording CRUD ──────────────────────────────────────────────────────────

def create_recording(
    speaker_id: str,
    audio_path: str,
    whisper_transcript: str = None,
    duration: float = None,
    emotion: str = "neutral",
) -> dict:
    if emotion not in VALID_EMOTIONS:
        emotion = "neutral"
    conn = get_connection()
    conn.execute(
        """INSERT INTO recordings
           (speaker_id, audio_path, whisper_transcript, final_transcript, duration,
            processing_status, emotion)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)""",
        (speaker_id, audio_path, whisper_transcript, whisper_transcript, duration, emotion),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM recordings WHERE id = last_insert_rowid()"
    ).fetchone()
    conn.close()
    return _enrich_recording(dict(row))


def _enrich_recording(rec: dict) -> dict:
    speaker = get_speaker(rec["speaker_id"])
    rec["speaker_name"] = speaker["name"] if speaker else "unknown"
    if speaker:
        rec["speaker_age"] = speaker.get("age")
        rec["speaker_gender"] = speaker.get("gender")
        rec["speaker_district"] = speaker.get("district")
    return rec


def list_recordings(status: str = None, speaker_id: str = None) -> list[dict]:
    conn = get_connection()
    query = """
        SELECT r.*, s.name AS speaker_name, s.age AS speaker_age,
               s.gender AS speaker_gender, s.district AS speaker_district
        FROM recordings r
        LEFT JOIN speakers s ON r.speaker_id = s.id
        WHERE 1=1
    """
    params = []
    if status:
        query += " AND r.status = ?"
        params.append(status)
    if speaker_id:
        query += " AND r.speaker_id = ?"
        params.append(speaker_id)
    query += " ORDER BY r.created_at DESC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_recording(recording_id: int) -> dict | None:
    conn = get_connection()
    row = conn.execute(
        """SELECT r.*, s.name AS speaker_name, s.age AS speaker_age,
                  s.gender AS speaker_gender, s.district AS speaker_district
           FROM recordings r
           LEFT JOIN speakers s ON r.speaker_id = s.id
           WHERE r.id = ?""",
        (recording_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def update_recording(recording_id: int, **fields) -> dict | None:
    conn = get_connection()
    allowed = {
        "final_transcript", "status", "whisper_transcript", "duration", "audio_path",
        "processing_status", "processing_error", "emotion", "synced_at",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if "emotion" in updates and updates["emotion"] not in VALID_EMOTIONS:
        updates.pop("emotion")
    if not updates:
        conn.close()
        return get_recording(recording_id)
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [recording_id]
    conn.execute(f"UPDATE recordings SET {set_clause} WHERE id = ?", values)
    conn.commit()
    row = conn.execute(
        """SELECT r.*, s.name AS speaker_name, s.age AS speaker_age,
                  s.gender AS speaker_gender, s.district AS speaker_district
           FROM recordings r
           LEFT JOIN speakers s ON r.speaker_id = s.id
           WHERE r.id = ?""",
        (recording_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def delete_recording(recording_id: int) -> bool:
    conn = get_connection()
    rec = conn.execute("SELECT audio_path FROM recordings WHERE id = ?", (recording_id,)).fetchone()
    if rec and rec["audio_path"] and os.path.exists(rec["audio_path"]):
        try:
            os.remove(rec["audio_path"])
        except OSError:
            pass
    cur = conn.execute("DELETE FROM recordings WHERE id = ?", (recording_id,))
    conn.commit()
    conn.close()
    return cur.rowcount > 0


def count_recordings(status: str = None) -> int:
    conn = get_connection()
    if status:
        row = conn.execute("SELECT COUNT(*) as c FROM recordings WHERE status = ?", (status,)).fetchone()
    else:
        row = conn.execute("SELECT COUNT(*) as c FROM recordings").fetchone()
    conn.close()
    return row["c"]


def mark_recordings_synced(recording_ids: list[int]):
    if not recording_ids:
        return
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    placeholders = ",".join("?" * len(recording_ids))
    conn.execute(
        f"UPDATE recordings SET synced_at = ? WHERE id IN ({placeholders})",
        [now, *recording_ids],
    )
    conn.commit()
    conn.close()


# ── Settings ────────────────────────────────────────────────────────────────

def get_setting(key: str) -> str | None:
    conn = get_connection()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else None


def set_setting(key: str, value: str):
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        (key, value),
    )
    conn.commit()
    conn.close()


def get_all_settings() -> dict:
    conn = get_connection()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    return {r["key"]: r["value"] for r in rows}
