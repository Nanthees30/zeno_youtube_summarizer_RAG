from fastapi import APIRouter, Depends, HTTPException, Request
from app.core.database import get_db
from app.models.schemas import RegisterRequest, LoginRequest, TokenResponse
from app.core.security import create_access_token, hash_password, verify_password
import asyncpg
from app.api.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password

router = APIRouter()

@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    db: asyncpg.Pool = Depends(get_db)
):
    async with db.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT * FROM users WHERE email=$1", body.email
        )
    if not user or not verify_password(user["password_hash"], body.password):
        raise HTTPException(401, "Invalid email or password")

    user_id = str(user["id"])
    return TokenResponse(
        access_token=create_access_token(user_id, user["email"]),
        user={"id": user_id, "email": user["email"], "name": user["name"]},
    )

@router.get("/me")
async def auth_me(current_user: dict = Depends(get_current_user)):
    return {
        "id": str(current_user["id"]),
        "email": current_user["email"],
        "name": current_user["name"],
    }

@router.post("/refresh", response_model=TokenResponse)
async def auth_refresh(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["id"])
    return TokenResponse(
        access_token=create_access_token(user_id, current_user["email"]),
        user={"id": user_id, "email": current_user["email"], "name": current_user["name"]},
    )