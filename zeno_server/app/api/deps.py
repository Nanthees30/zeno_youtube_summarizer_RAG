from typing import Optional
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from app.core.config import settings
from app.core.database import get_db
import asyncpg

_bearer = HTTPBearer(auto_error=False)

async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: asyncpg.Pool = Depends(get_db),
) -> dict:
    if creds is None:
        raise HTTPException(401, "Authorization header missing")
    try:
        payload = jwt.decode(
            creds.credentials,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(401, "Invalid token")
    except JWTError:
        raise HTTPException(401, "Invalid or expired token")

    async with db.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT * FROM users WHERE id=$1::uuid", user_id
        )
    if not user:
        raise HTTPException(401, "User not found")
    return dict(user)