from __future__ import annotations

from pathlib import Path
import sqlite3
from typing import Any


def connect(database_path: Path) -> sqlite3.Connection:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(database_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(database_path: Path) -> None:
    with connect(database_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS attempts (
                id TEXT PRIMARY KEY,
                scenario_id TEXT NOT NULL,
                sentence_id TEXT NOT NULL,
                reference_text TEXT NOT NULL,
                audio_path TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                azure_raw_json TEXT NOT NULL,
                normalized_json TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_attempts_sentence_created
            ON attempts(sentence_id, created_at)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_attempts_created
            ON attempts(created_at)
            """
        )


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}
