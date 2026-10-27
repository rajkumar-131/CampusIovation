"""
database.py — Dual-Engine Database Manager (PostgreSQL in Production, SQLite in Dev).

Architecture:
  - Production (Render): When DATABASE_URL is set (Supabase, Neon, or Render PostgreSQL),
    connects to persistent PostgreSQL with automatic query translation.
  - Development / Fallback: When DATABASE_URL is unset, connects to local SQLite
    with WAL mode in greencampus.db.
  - Zero disruption: All tables, columns, constraints, and data models remain 100% compatible.
"""

import os
import sqlite3
import logging
from pathlib import Path
from typing import Optional, Any
from dotenv import load_dotenv

logger = logging.getLogger("greencampus.db")
logging.basicConfig(level=logging.INFO)

# Load .env file
ENV_PATH = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=ENV_PATH)

DB_PATH = Path(__file__).parent / "greencampus.db"


def _get_database_url() -> Optional[str]:
    """Retrieve DATABASE_URL if configured and non-empty."""
    url = os.getenv("DATABASE_URL", "").strip()
    if url and (url.startswith("postgres://") or url.startswith("postgresql://")):
        # SQLAlchemy and some drivers require postgresql:// instead of postgres://
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        return url
    return None


def get_db_type() -> str:
    """Returns 'postgresql' if DATABASE_URL is configured, else 'sqlite'."""
    return "postgresql" if _get_database_url() else "sqlite"


def is_persistent() -> bool:
    """Returns True if database survives server restarts (PostgreSQL)."""
    return bool(_get_database_url())


def get_db_info() -> dict:
    """Safe status metadata for /api/health (never leaks credentials)."""
    db_type = get_db_type()
    if db_type == "postgresql":
        # Extract host safely without user/pass
        raw_url = _get_database_url() or ""
        host_display = "remote-managed-postgres"
        try:
            if "@" in raw_url:
                host_part = raw_url.split("@")[1].split("/")[0]
                host_display = host_part
        except Exception:
            pass
        return {
            "type": "postgresql",
            "persistent": True,
            "host": host_display,
            "notes": "Persistent managed PostgreSQL active",
        }
    else:
        return {
            "type": "sqlite",
            "persistent": False,
            "file": "greencampus.db",
            "notes": "Local SQLite active (Ephemeral on Render free-tier)",
        }


class DBConnectionWrapper:
    """
    Transparent connection wrapper that unifies SQLite and PostgreSQL.
    Provides identical .execute(sql, params) and dictionary row access.
    """
    def __init__(self, raw_conn, is_postgres: bool = False):
        self.raw_conn = raw_conn
        self.is_postgres = is_postgres

    def execute(self, sql: str, params: Any = ()):
        if self.is_postgres:
            # PostgreSQL uses %s instead of ? placeholders
            pg_sql = sql.replace("?", "%s")
            # Replace SQLite datetime functions with PostgreSQL equivalents
            pg_sql = pg_sql.replace("datetime('now', 'localtime')", "NOW()")
            cur = self.raw_conn.cursor()
            cur.execute(pg_sql, params)
            return cur
        else:
            return self.raw_conn.execute(sql, params)

    def executemany(self, sql: str, params: Any = ()):
        if self.is_postgres:
            import re
            pg_sql = re.sub(r':([a-zA-Z0-9_]+)', r'%(\1)s', sql)
            pg_sql = pg_sql.replace("?", "%s")
            pg_sql = pg_sql.replace("datetime('now', 'localtime')", "NOW()")
            cur = self.raw_conn.cursor()
            cur.executemany(pg_sql, params)
            return cur
        else:
            return self.raw_conn.executemany(sql, params)

    def commit(self):
        self.raw_conn.commit()

    def rollback(self):
        self.raw_conn.rollback()

    def close(self):
        self.raw_conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self.rollback()
        else:
            self.commit()
        self.close()


def get_connection() -> DBConnectionWrapper:
    """
    Open and return a database connection wrapped for SQLite or PostgreSQL.
    """
    db_url = _get_database_url()

    if db_url:
        try:
            import psycopg2
            import psycopg2.extras
            conn = psycopg2.connect(db_url, cursor_factory=psycopg2.extras.RealDictCursor)
            return DBConnectionWrapper(conn, is_postgres=True)
        except ImportError:
            logger.warning("psycopg2 not installed. Falling back to local SQLite.")
        except Exception as e:
            logger.error("Failed to connect to PostgreSQL (%s). Falling back to SQLite.", e)

    # SQLite Fallback / Local Development
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return DBConnectionWrapper(conn, is_postgres=False)


def create_tables():
    """Create all database tables if they do not exist yet."""
    db_type = get_db_type()

    with get_connection() as conn:
        if conn.is_postgres:
            logger.info("Setting up PostgreSQL database schema...")
            # 1. Tickets table (PostgreSQL)
            conn.raw_conn.cursor().execute("""
                CREATE TABLE IF NOT EXISTS tickets (
                    id             SERIAL PRIMARY KEY,
                    title          TEXT    NOT NULL,
                    description    TEXT    NOT NULL,
                    category       TEXT    NOT NULL,
                    location       TEXT    NOT NULL,
                    department     TEXT    NOT NULL DEFAULT 'Unassigned',
                    priority       TEXT    NOT NULL DEFAULT 'Medium'
                                           CHECK(priority IN ('High', 'Medium', 'Low')),
                    status         TEXT    NOT NULL DEFAULT 'Open'
                                           CHECK(status IN ('Open', 'In Progress', 'Resolved')),
                    submitted_by   TEXT    NOT NULL DEFAULT 'Anonymous',
                    ai_suggestion  TEXT,
                    ai_explanation TEXT,
                    ai_action      TEXT,
                    created_at     TEXT    NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
                );
            """)

            # 2. Campus Connect: Student profiles (PostgreSQL)
            conn.raw_conn.cursor().execute("""
                CREATE TABLE IF NOT EXISTS student_profiles (
                    id          SERIAL PRIMARY KEY,
                    name        TEXT    NOT NULL,
                    department  TEXT    NOT NULL,
                    study_year  TEXT    NOT NULL,
                    bio         TEXT    DEFAULT '',
                    interests   TEXT    DEFAULT '[]',
                    created_at  TEXT    NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
                );
            """)

            # 3. Campus Connect: Student availability broadcasts (PostgreSQL)
            conn.raw_conn.cursor().execute("""
                CREATE TABLE IF NOT EXISTS student_availabilities (
                    id               SERIAL PRIMARY KEY,
                    profile_id       INTEGER NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
                    activity         TEXT    NOT NULL CHECK(activity IN ('STUDY', 'COFFEE', 'LUNCH', 'WALK', 'CASUAL_CHAT')),
                    duration_minutes INTEGER NOT NULL CHECK(duration_minutes IN (15, 30, 60)),
                    location_area    TEXT    DEFAULT 'Anywhere on Campus',
                    note             TEXT    DEFAULT '',
                    available_from   TEXT    NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
                    expires_at       TEXT    NOT NULL,
                    status           TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'CANCELLED', 'EXPIRED')),
                    created_at       TEXT    NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
                );
            """)

            # 4. Campus Connect: Connection requests (PostgreSQL)
            conn.raw_conn.cursor().execute("""
                CREATE TABLE IF NOT EXISTS connection_requests (
                    id           SERIAL PRIMARY KEY,
                    sender_id    INTEGER NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
                    receiver_id  INTEGER NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
                    status       TEXT    NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
                    message      TEXT    DEFAULT '',
                    created_at   TEXT    NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
                    updated_at   TEXT    NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
                );
            """)

            # 5. Campus Connect: Peer-to-peer chat messages (PostgreSQL)
            conn.raw_conn.cursor().execute("""
                CREATE TABLE IF NOT EXISTS peer_messages (
                    id             SERIAL PRIMARY KEY,
                    connection_id  INTEGER NOT NULL REFERENCES connection_requests(id) ON DELETE CASCADE,
                    sender_id      INTEGER NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
                    receiver_id    INTEGER NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
                    content        TEXT    NOT NULL,
                    is_read        BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at     TEXT    NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
                );
            """)
            conn.commit()
            logger.info("PostgreSQL database tables verified.")

        else:
            # 1. Existing tickets table (SQLite)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tickets (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    title          TEXT    NOT NULL,
                    description    TEXT    NOT NULL,
                    category       TEXT    NOT NULL,
                    location       TEXT    NOT NULL,
                    department     TEXT    NOT NULL DEFAULT 'Unassigned',
                    priority       TEXT    NOT NULL DEFAULT 'Medium'
                                           CHECK(priority IN ('High', 'Medium', 'Low')),
                    status         TEXT    NOT NULL DEFAULT 'Open'
                                           CHECK(status IN ('Open', 'In Progress', 'Resolved')),
                    submitted_by   TEXT    NOT NULL DEFAULT 'Anonymous',
                    ai_suggestion  TEXT,
                    ai_explanation TEXT,
                    ai_action      TEXT,
                    created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
                )
            """)

            # Safe migration for tickets table
            existing_cols = {
                row["name"] for row in conn.execute("PRAGMA table_info(tickets)").fetchall()
            }
            if "ai_explanation" not in existing_cols:
                conn.execute("ALTER TABLE tickets ADD COLUMN ai_explanation TEXT")
            if "ai_action" not in existing_cols:
                conn.execute("ALTER TABLE tickets ADD COLUMN ai_action TEXT")

            # 2. Campus Connect: Student profiles (SQLite)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS student_profiles (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    name        TEXT    NOT NULL,
                    department  TEXT    NOT NULL,
                    study_year  TEXT    NOT NULL,
                    bio         TEXT    DEFAULT '',
                    interests   TEXT    DEFAULT '[]',
                    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
                )
            """)

            # 3. Campus Connect: Student availability broadcasts (SQLite)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS student_availabilities (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_id       INTEGER NOT NULL,
                    activity         TEXT    NOT NULL CHECK(activity IN ('STUDY', 'COFFEE', 'LUNCH', 'WALK', 'CASUAL_CHAT')),
                    duration_minutes INTEGER NOT NULL CHECK(duration_minutes IN (15, 30, 60)),
                    location_area    TEXT    DEFAULT 'Anywhere on Campus',
                    note             TEXT    DEFAULT '',
                    available_from   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
                    expires_at       TEXT    NOT NULL,
                    status           TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'CANCELLED', 'EXPIRED')),
                    created_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY(profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE
                )
            """)

            # 4. Campus Connect Step 2: Connection requests (SQLite)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS connection_requests (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    sender_id    INTEGER NOT NULL,
                    receiver_id  INTEGER NOT NULL,
                    status       TEXT    NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
                    message      TEXT    DEFAULT '',
                    created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
                    updated_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY(sender_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                    FOREIGN KEY(receiver_id) REFERENCES student_profiles(id) ON DELETE CASCADE
                )
            """)

            # 5. Campus Connect: Peer-to-peer chat messages (SQLite)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS peer_messages (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    connection_id  INTEGER NOT NULL,
                    sender_id      INTEGER NOT NULL,
                    receiver_id    INTEGER NOT NULL,
                    content        TEXT    NOT NULL,
                    is_read        BOOLEAN NOT NULL DEFAULT 0,
                    created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY(connection_id) REFERENCES connection_requests(id) ON DELETE CASCADE,
                    FOREIGN KEY(sender_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                    FOREIGN KEY(receiver_id) REFERENCES student_profiles(id) ON DELETE CASCADE
                )
            """)
            conn.commit()
