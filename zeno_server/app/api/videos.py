from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.schemas import IndexVideoRequest
from app.services.transcript import fetch_transcript, chunk_transcript
from app.services.pinecone_db import upsert_chunks
from app.services.youtube import extract_video_id, fetch_video_metadata
import asyncpg
import asyncio

router = APIRouter()
@router.delete("/videos/{video_id}")
async def delete_video(
    video_id: str,
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Pool = Depends(get_db)
):
    user_id = str(current_user["id"])
    async with db.acquire() as conn:
        deleted = await conn.fetchval(
            "DELETE FROM videos WHERE user_id=$1::uuid AND video_id=$2 RETURNING id",
            user_id, video_id,
        )
    if not deleted:
        raise HTTPException(404, "Video not found")
    return {"message": f"Video {video_id} removed"}

@router.get("/videos")
async def list_videos(
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Pool = Depends(get_db)
):
    user_id = str(current_user["id"])
    async with db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, video_id, title, channel, thumbnail, "
            "chunk_count, status, error_msg, indexed_at "
            "FROM videos WHERE user_id=$1::uuid ORDER BY indexed_at DESC",
            user_id,
        )
    return [
        {
            "id": str(r["id"]),
            "video_id": r["video_id"],
            "title": r["title"],
            "channel": r["channel"],
            "thumbnail": r["thumbnail"],
            "chunk_count": r["chunk_count"],
            "status": r["status"],
            "error_msg": r["error_msg"],
            "indexed_at": r["indexed_at"].isoformat(),
        }
        for r in rows
    ]

@router.get("/video-status")
async def video_status(
    video_id: str = None,
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Pool = Depends(get_db)
):
    user_id = str(current_user["id"])
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, error_msg FROM videos "
            "WHERE user_id=$1::uuid AND video_id=$2",
            user_id, video_id,
        )
    if not row:
        return {"ready": False, "indexing": False, "failed": False}
    return {
        "ready": row["status"] == "ready",
        "indexing": row["status"] == "processing",
        "failed": row["status"] == "failed",
        "error_msg": row["error_msg"],
    }

@router.post("/index-video")
async def index_video(
    body: IndexVideoRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Pool = Depends(get_db),
):
    user_id = str(current_user["id"])
    video_id = extract_video_id(body.url)
    if not video_id:
        raise HTTPException(400, "Invalid YouTube URL")

    async with db.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT id, status FROM videos WHERE user_id=$1::uuid AND video_id=$2",
            user_id, video_id,
        )
    if existing and existing["status"] == "ready":
        return {"message": "Already indexed", "video_id": video_id}

    metadata = await fetch_video_metadata(video_id)

    async with db.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO videos (user_id, video_id, title, channel, thumbnail)
            VALUES ($1::uuid, $2, $3, $4, $5)
            ON CONFLICT (user_id, video_id) DO UPDATE
              SET status='processing', error_msg=NULL
            RETURNING id
            """,
            user_id, video_id, metadata["title"],
            metadata["channel"], metadata["thumbnail"],
        )
    db_id = str(row["id"])

    background_tasks.add_task(
        _process_video, video_id, metadata, user_id, db_id, db
    )

    return {
        "message": "Indexing started",
        "video_id": video_id,
        "title": metadata["title"],
    }

async def _process_video(
    video_id, metadata, user_id, db_id, db
):
    try:
        segments = await fetch_transcript(video_id)
        chunks = chunk_transcript(segments, metadata)
        await asyncio.to_thread(upsert_chunks, chunks, user_id, video_id)
        async with db.acquire() as conn:
            await conn.execute(
                "UPDATE videos SET chunk_count=$1, status='ready' WHERE id=$2::uuid",
                len(chunks), db_id,
            )
    except Exception as e:
        async with db.acquire() as conn:
            await conn.execute(
                "UPDATE videos SET status='failed', error_msg=$1 WHERE id=$2::uuid",
                str(e), db_id,
            )