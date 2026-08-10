from fastapi import APIRouter, Depends, HTTPException, status
import asyncpg
from app.core.database import get_db
from app.models.schemas import RegisterRequest, LoginRequest, TokenResponse
from app.core.security import create_access_token, hash_password, verify_password
from app.api.deps import get_current_user

router = APIRouter()

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    db: asyncpg.Pool = Depends(get_db)
):
    async with db.acquire() as conn:
        # 1. Check if email or username already exists
        existing_user = await conn.fetchrow(
            "SELECT id FROM users WHERE email = $1 OR username = $2",
            body.email, body.username
        )
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User with this email or username already exists"
            )

        # 2. Hash password and insert user into Postgres DB
        hashed_pwd = hash_password(body.password)
        display_name = getattr(body, 'name', None) or body.username

        new_user = await conn.fetchrow(
            """
            INSERT INTO users (username, email, password_hash, name)
            VALUES ($1, $2, $3, $4)
            RETURNING id, email, name
            """,
            body.username, body.email, hashed_pwd, display_name
        )

    user_id = str(new_user["id"])
    return TokenResponse(
        access_token=create_access_token(user_id, new_user["email"]),
        user={"id": user_id, "email": new_user["email"], "name": new_user["name"]},
    )

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