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

ADMIN_USERNAME = "spidy"
DEFAULT_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Sachuachu@2004")


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
        ("speakers", "user_id", "TEXT REFERENCES users(id)"),
        ("speakers", "hf_repo", "TEXT"),
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


def _seed_admin(conn: sqlite3.Connection):
    import bcrypt

    row = conn.execute(
        "SELECT id FROM users WHERE username = ?", (ADMIN_USERNAME,)
    ).fetchone()
    if row:
        return
    user_id = str(uuid.uuid4())
    password_hash = bcrypt.hashpw(
        DEFAULT_ADMIN_PASSWORD.encode(), bcrypt.gensalt(rounds=12)
    ).decode()
    conn.execute(
        """INSERT INTO users (id, name, username, password_hash, is_admin)
           VALUES (?, ?, ?, ?, 1)""",
        (user_id, "Admin", ADMIN_USERNAME, password_hash),
    )


def init_db():
    """Create tables if they don't exist."""
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

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
    _seed_admin(conn)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_recordings_processing ON recordings(processing_status)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_speakers_user ON speakers(user_id)
    """)
    conn.commit()
    conn.close()


def _user_row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


# ── User CRUD ───────────────────────────────────────────────────────────────

def create_user(name: str, username: str, password_hash: str, is_admin: bool = False) -> dict:
    conn = get_connection()
    user_id = str(uuid.uuid4())
    try:
        conn.execute(
            """INSERT INTO users (id, name, username, password_hash, is_admin)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, name, username, password_hash, 1 if is_admin else 0),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    except sqlite3.IntegrityError:
        conn.close()
        raise ValueError("Username already taken")
    conn.close()
    return _user_row_to_dict(row)


def get_user_by_id(user_id: str) -> dict | None:
    conn = get_connection()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return _user_row_to_dict(row) if row else None


def get_user_by_username(username: str) -> dict | None:
    conn = get_connection()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    return _user_row_to_dict(row) if row else None


# ── Speaker CRUD ────────────────────────────────────────────────────────────

def create_speaker(
    name: str,
    user_id: str,
    age: int = None,
    gender: str = None,
    district: str = None,
) -> dict:
    conn = get_connection()
    speaker_id = str(uuid.uuid4())[:8]
    conn.execute(
        """INSERT INTO speakers (id, name, age, gender, district, user_id)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (speaker_id, name, age, gender, district, user_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM speakers WHERE id = ?", (speaker_id,)).fetchone()
    conn.close()
    return dict(row)


def list_speakers(user_id: str | None = None, is_admin: bool = False) -> list[dict]:
    conn = get_connection()
    if is_admin:
        rows = conn.execute("""
            SELECT s.*, u.name AS owner_name, u.username AS owner_username
            FROM speakers s
            LEFT JOIN users u ON s.user_id = u.id
            ORDER BY s.created_at DESC
        """).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM speakers WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_speaker(speaker_id: str, user_id: str | None = None, is_admin: bool = False) -> dict | None:
    conn = get_connection()
    if is_admin:
        row = conn.execute(
            """SELECT s.*, u.name AS owner_name, u.username AS owner_username
               FROM speakers s
               LEFT JOIN users u ON s.user_id = u.id
               WHERE s.id = ?""",
            (speaker_id,),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT * FROM speakers WHERE id = ? AND user_id = ?",
            (speaker_id, user_id),
        ).fetchone()
    conn.close()
    return dict(row) if row else None


def update_speaker(
    speaker_id: str,
    user_id: str | None = None,
    is_admin: bool = False,
    **fields,
) -> dict | None:
    if not get_speaker(speaker_id, user_id=user_id, is_admin=is_admin):
        return None

    allowed = {"hf_repo"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return get_speaker(speaker_id, user_id=user_id, is_admin=is_admin)

    conn = get_connection()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [speaker_id]
    conn.execute(f"UPDATE speakers SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return get_speaker(speaker_id, user_id=user_id, is_admin=is_admin)


def delete_speaker(speaker_id: str, user_id: str | None = None, is_admin: bool = False) -> bool:
    conn = get_connection()
    if is_admin:
        exists = conn.execute("SELECT id FROM speakers WHERE id = ?", (speaker_id,)).fetchone()
    else:
        exists = conn.execute(
            "SELECT id FROM speakers WHERE id = ? AND user_id = ?",
            (speaker_id, user_id),
        ).fetchone()
    if not exists:
        conn.close()
        return False

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

def _recording_scope_clause(is_admin: bool, user_id: str | None) -> tuple[str, list]:
    if is_admin:
        return "", []
    return " AND s.user_id = ?", [user_id]


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
    conn = get_connection()
    row = conn.execute("SELECT * FROM speakers WHERE id = ?", (rec["speaker_id"],)).fetchone()
    conn.close()
    speaker = dict(row) if row else None
    rec["speaker_name"] = speaker["name"] if speaker else "unknown"
    if speaker:
        rec["speaker_age"] = speaker.get("age")
        rec["speaker_gender"] = speaker.get("gender")
        rec["speaker_district"] = speaker.get("district")
    return rec


def list_recordings(
    status: str = None,
    speaker_id: str = None,
    user_id: str | None = None,
    is_admin: bool = False,
) -> list[dict]:
    conn = get_connection()
    scope, scope_params = _recording_scope_clause(is_admin, user_id)
    owner_cols = ", u.name AS owner_name, u.username AS owner_username" if is_admin else ""
    user_join = " LEFT JOIN users u ON s.user_id = u.id" if is_admin else ""

    query = f"""
        SELECT r.*, s.name AS speaker_name, s.age AS speaker_age,
               s.gender AS speaker_gender, s.district AS speaker_district{owner_cols}
        FROM recordings r
        LEFT JOIN speakers s ON r.speaker_id = s.id{user_join}
        WHERE 1=1{scope}
    """
    params = list(scope_params)
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


def get_recording(
    recording_id: int,
    user_id: str | None = None,
    is_admin: bool = False,
) -> dict | None:
    conn = get_connection()
    scope, scope_params = _recording_scope_clause(is_admin, user_id)
    owner_cols = ", u.name AS owner_name, u.username AS owner_username" if is_admin else ""
    user_join = " LEFT JOIN users u ON s.user_id = u.id" if is_admin else ""

    row = conn.execute(
        f"""SELECT r.*, s.name AS speaker_name, s.age AS speaker_age,
                  s.gender AS speaker_gender, s.district AS speaker_district{owner_cols}
           FROM recordings r
           LEFT JOIN speakers s ON r.speaker_id = s.id{user_join}
           WHERE r.id = ?{scope}""",
        [recording_id, *scope_params],
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def update_recording(
    recording_id: int,
    user_id: str | None = None,
    is_admin: bool = False,
    _internal: bool = False,
    **fields,
) -> dict | None:
    if not _internal and not get_recording(recording_id, user_id=user_id, is_admin=is_admin):
        return None

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
        if _internal:
            return get_recording(recording_id, is_admin=True)
        return get_recording(recording_id, user_id=user_id, is_admin=is_admin)

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [recording_id]
    conn.execute(f"UPDATE recordings SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    if _internal:
        return get_recording(recording_id, is_admin=True)
    return get_recording(recording_id, user_id=user_id, is_admin=is_admin)


def delete_recording(
    recording_id: int,
    user_id: str | None = None,
    is_admin: bool = False,
) -> bool:
    rec = get_recording(recording_id, user_id=user_id, is_admin=is_admin)
    if not rec:
        return False

    conn = get_connection()
    if rec.get("audio_path") and os.path.exists(rec["audio_path"]):
        try:
            os.remove(rec["audio_path"])
        except OSError:
            pass
    cur = conn.execute("DELETE FROM recordings WHERE id = ?", (recording_id,))
    conn.commit()
    conn.close()
    return cur.rowcount > 0


def count_recordings(
    status: str = None,
    speaker_id: str = None,
    user_id: str | None = None,
    is_admin: bool = False,
) -> int:
    conn = get_connection()
    scope, scope_params = _recording_scope_clause(is_admin, user_id)
    speaker_clause = ""
    speaker_params: list = []
    if speaker_id:
        speaker_clause = " AND r.speaker_id = ?"
        speaker_params.append(speaker_id)
    if status:
        row = conn.execute(
            f"""SELECT COUNT(*) as c FROM recordings r
                LEFT JOIN speakers s ON r.speaker_id = s.id
                WHERE r.status = ?{scope}{speaker_clause}""",
            [status, *scope_params, *speaker_params],
        ).fetchone()
    else:
        row = conn.execute(
            f"""SELECT COUNT(*) as c FROM recordings r
                LEFT JOIN speakers s ON r.speaker_id = s.id
                WHERE 1=1{scope}{speaker_clause}""",
            [*scope_params, *speaker_params],
        ).fetchone()
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
