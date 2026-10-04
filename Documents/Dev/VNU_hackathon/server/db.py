"""MedIndex SQLite storage (Python standard library only).

The database lives at server/data/medindex.db (override with the MEDINDEX_DB environment
variable, e.g. for tests). The directory is created with mode 700 and the file is chmod 600.
Schema changes are applied as numbered migrations (PRAGMA user_version); the database is
never dropped or reset, and the demo admin account is only inserted when it does not exist.
"""
import os
import sqlite3
import time

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(SERVER_DIR, "data", "medindex.db")
DB_PATH = os.path.abspath(os.environ.get("MEDINDEX_DB") or DEFAULT_DB)

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "adminboss"   # demo account (documented in server/README.md)
ADMIN_DISPLAY = "Admin"

MIGRATIONS = [
    # 1: initial schema
    """
    CREATE TABLE users (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        username     TEXT UNIQUE,
        email        TEXT UNIQUE,
        phone        TEXT UNIQUE,
        display_name TEXT,
        pw_hash      TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        CHECK (username IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL)
    );
    CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL
    );
    CREATE INDEX sessions_user ON sessions(user_id);
    CREATE TABLE reviews (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        doctor_id  INTEGER NOT NULL,
        stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
        comment    TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        UNIQUE (user_id, doctor_id)
    );
    CREATE INDEX reviews_doctor ON reviews(doctor_id, created_at);
    CREATE TABLE subscriptions (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        plan       TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly')),
        active     INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        renews_at  INTEGER NOT NULL
    );
    CREATE TABLE cloud_folders (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        system     INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE (user_id, name)
    );
    CREATE TABLE cloud_files (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        folder_id  INTEGER REFERENCES cloud_folders(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        mime       TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        created_at INTEGER NOT NULL
    );
    CREATE INDEX cloud_files_user ON cloud_files(user_id);
    CREATE TABLE chats (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX chats_user ON chats(user_id, updated_at);
    CREATE TABLE chat_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content    TEXT NOT NULL,
        meta_json  TEXT,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX chat_messages_chat ON chat_messages(chat_id, id);
    """,
]


def connect():
    """A new connection per request (sqlite3 connections are not shared across threads).
    Autocommit mode: callers use explicit BEGIN IMMEDIATE ... COMMIT for multi-step writes."""
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _secure_paths():
    for suffix in ("", "-journal", "-wal", "-shm"):
        p = DB_PATH + suffix
        if os.path.exists(p):
            try:
                os.chmod(p, 0o600)
            except OSError:
                pass


def init(hash_password):
    """Create the directory and file, apply pending migrations, seed the admin (idempotent)."""
    d = os.path.dirname(DB_PATH)
    os.makedirs(d, mode=0o700, exist_ok=True)
    if not os.path.exists(DB_PATH):
        fd = os.open(DB_PATH, os.O_CREAT | os.O_WRONLY, 0o600)  # never world-readable, even briefly
        os.close(fd)
    _secure_paths()
    conn = connect()
    try:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        for i in range(version, len(MIGRATIONS)):
            conn.execute("BEGIN IMMEDIATE")
            try:
                for stmt in [s.strip() for s in MIGRATIONS[i].split(";") if s.strip()]:
                    conn.execute(stmt)
                conn.execute("PRAGMA user_version = %d" % (i + 1))
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        row = conn.execute("SELECT id FROM users WHERE username = ?", (ADMIN_USERNAME,)).fetchone()
        if row is None:
            conn.execute("INSERT OR IGNORE INTO users (username, display_name, pw_hash, created_at) VALUES (?, ?, ?, ?)",
                         (ADMIN_USERNAME, ADMIN_DISPLAY, hash_password(ADMIN_PASSWORD), int(time.time())))
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
    finally:
        conn.close()
    _secure_paths()
