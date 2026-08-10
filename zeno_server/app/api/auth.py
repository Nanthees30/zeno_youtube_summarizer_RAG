from fastapi import APIRouter, Depends, HTTPException, status
import aiosqlite
from app.core.database import get_db
from app.models.schemas import RegisterRequest, LoginRequest, TokenResponse
from app.core.security import create_access_token, hash_password, verify_password
from app.api.deps import get_current_user

router = APIRouter()

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute(
        "SELECT id FROM users WHERE email = ? OR username = ?",
        (body.email, body.username)
    ) as cursor:
        existing = await cursor.fetchone()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email or username already exists"
        )

    hashed_pwd = hash_password(body.password)
    display_name = getattr(body, 'name', None) or body.username

    cursor = await db.execute(
        "INSERT INTO users (username, email, password_hash, name) VALUES (?, ?, ?, ?)",
        (body.username, body.email, hashed_pwd, display_name)
    )
    await db.commit()
    user_id = str(cursor.lastrowid)

    return TokenResponse(
        access_token=create_access_token(user_id, body.email),
        user={"id": user_id, "email": body.email, "name": display_name},
    )

@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT * FROM users WHERE email = ?", (body.email,)) as cursor:
        user = await cursor.fetchone()

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