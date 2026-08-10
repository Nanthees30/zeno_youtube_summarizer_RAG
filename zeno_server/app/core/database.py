import aiosqlite
from typing import Optional

_db_conn: Optional[aiosqlite.Connection] = None

async def init_db(database_url: str = "zeno.db") -> None:
    global _db_conn
    _db_conn = await aiosqlite.connect("zeno.db")
    _db_conn.row_factory = aiosqlite.Row

    # Create all required SQLite tables on startup
    await _db_conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT
        );

        CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            video_id TEXT NOT NULL,
            title TEXT,
            channel TEXT,
            thumbnail TEXT,
            chunk_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'processing',
            error_msg TEXT,
            indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, video_id)
        );

        CREATE TABLE IF NOT EXISTS query_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            video_id TEXT,
            query TEXT NOT NULL,
            answer TEXT,
            sources_count INTEGER DEFAULT 0,
            mode TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    await _db_conn.commit()

async def get_db() -> aiosqlite.Connection:
    return _db_conn

async def close_db() -> None:
    global _db_conn
    if _db_conn:
        await _db_conn.close()
        _db_conn = None