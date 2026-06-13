import asyncpg
from typing import Optional

_db_pool: Optional[asyncpg.pool] = None

async def init_db(database_url: str) -> None:
    global _db_pool
    _db_pool = await asyncpg.create_pool(
        database_url,
        min_size = 2,
        max_size = 10
    )
def get_db() -> asyncpg.pool:
    return _db_pool
async def close_db() -> None:
    if _db_pool:
        await _db_pool.close()

