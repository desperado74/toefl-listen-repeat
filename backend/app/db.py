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
                client_id TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        _ensure_column(conn, "attempts", "client_id", "TEXT NOT NULL DEFAULT ''")
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
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_attempts_client_created
            ON attempts(client_id, created_at)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reading_attempts (
                id TEXT PRIMARY KEY,
                set_id TEXT NOT NULL,
                answers_json TEXT NOT NULL,
                result_json TEXT NOT NULL,
                elapsed_ms INTEGER NOT NULL,
                client_id TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        _ensure_column(conn, "reading_attempts", "client_id", "TEXT NOT NULL DEFAULT ''")
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_reading_attempts_created
            ON reading_attempts(created_at)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_reading_attempts_client_created
            ON reading_attempts(client_id, created_at)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS interview_attempts (
                id TEXT PRIMARY KEY,
                set_id TEXT NOT NULL,
                question_id TEXT NOT NULL,
                audio_path TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                transcript TEXT NOT NULL DEFAULT '',
                ai_feedback_json TEXT NOT NULL DEFAULT '{}',
                rubric_scores_json TEXT NOT NULL DEFAULT '{}',
                scoring_status TEXT NOT NULL DEFAULT 'not_scored',
                client_id TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        _ensure_column(conn, "interview_attempts", "client_id", "TEXT NOT NULL DEFAULT ''")
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_interview_attempts_question_created
            ON interview_attempts(question_id, created_at)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_interview_attempts_created
            ON interview_attempts(created_at)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_interview_attempts_client_created
            ON interview_attempts(client_id, created_at)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS interview_reference_answers (
                id TEXT PRIMARY KEY,
                set_id TEXT NOT NULL,
                question_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                answer_text TEXT NOT NULL,
                learning_points_json TEXT NOT NULL,
                target_level TEXT NOT NULL,
                word_count INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_reference_unique
            ON interview_reference_answers(set_id, question_id, provider, model, target_level)
            """
        )


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}
