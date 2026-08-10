import aiosqlite
from typing import Optional

_db_conn: Optional[aiosqlite.Connection] = None

async def init_db(database_url: str = "zeno.db") -> None:
    global _db_conn
    _db_conn = await aiosqlite.connect("zeno.db")
    _db_conn.row_factory = aiosqlite.Row

    # Auto-create Users table on startup
    await _db_conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT
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