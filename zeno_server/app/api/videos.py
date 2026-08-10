from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
import aiosqlite
import asyncio
from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.schemas import IndexVideoRequest
from app.services.transcript import fetch_transcript, chunk_transcript
from app.services.pinecone_db import upsert_chunks
from app.services.youtube import extract_video_id, fetch_video_metadata

router = APIRouter()

@router.delete("/videos/{video_id}")
async def delete_video(
    video_id: str,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db)
):
    user_id = str(current_user["id"])
    async with db.execute(
        "SELECT id FROM videos WHERE user_id = ? AND video_id = ?",
        (user_id, video_id)
    ) as cursor:
        row = await cursor.fetchone()

    if not row:
        raise HTTPException(404, "Video not found")

    await db.execute(
        "DELETE FROM videos WHERE user_id = ? AND video_id = ?",
        (user_id, video_id)
    )
    await db.commit()
    return {"message": f"Video {video_id} removed"}

@router.get("/videos")
async def list_videos(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db)
):
    user_id = str(current_user["id"])
    async with db.execute(
        """
        SELECT id, video_id, title, channel, thumbnail,
               chunk_count, status, error_msg, indexed_at
        FROM videos WHERE user_id = ? ORDER BY indexed_at DESC
        """,
        (user_id,)
    ) as cursor:
        rows = await cursor.fetchall()

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
            "indexed_at": str(r["indexed_at"]),
        }
        for r in rows
    ]

@router.get("/video-status")
async def video_status(
    video_id: str = None,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db)
):
    user_id = str(current_user["id"])
    async with db.execute(
        "SELECT status, error_msg FROM videos WHERE user_id = ? AND video_id = ?",
        (user_id, video_id)
    ) as cursor:
        row = await cursor.fetchone()

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
    db: aiosqlite.Connection = Depends(get_db),
):
    user_id = str(current_user["id"])
    video_id = extract_video_id(body.url)
    if not video_id:
        raise HTTPException(400, "Invalid YouTube URL")

    async with db.execute(
        "SELECT id, status FROM videos WHERE user_id = ? AND video_id = ?",
        (user_id, video_id)
    ) as cursor:
        existing = await cursor.fetchone()

    if existing and existing["status"] == "ready":
        return {"message": "Already indexed", "video_id": video_id}

    metadata = await fetch_video_metadata(video_id)

    await db.execute(
        """
        INSERT INTO videos (user_id, video_id, title, channel, thumbnail, status, error_msg)
        VALUES (?, ?, ?, ?, ?, 'processing', NULL)
        ON CONFLICT(user_id, video_id) DO UPDATE SET
            status = 'processing',
            error_msg = NULL
        """,
        (user_id, video_id, metadata["title"], metadata["channel"], metadata["thumbnail"])
    )
    await db.commit()

    async with db.execute(
        "SELECT id FROM videos WHERE user_id = ? AND video_id = ?",
        (user_id, video_id)
    ) as cursor:
        row = await cursor.fetchone()

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
    video_id, metadata, user_id, db_id, db: aiosqlite.Connection
):
    try:
        segments = await fetch_transcript(video_id)
        chunks = chunk_transcript(segments, metadata)
        await asyncio.to_thread(upsert_chunks, chunks, user_id, video_id)
        
        await db.execute(
            "UPDATE videos SET chunk_count = ?, status = 'ready' WHERE id = ?",
            (len(chunks), int(db_id))
        )
        await db.commit()
    except Exception as e:
        await db.execute(
            "UPDATE videos SET status = 'failed', error_msg = ? WHERE id = ?",
            (str(e), int(db_id))
        )
        await db.commit()