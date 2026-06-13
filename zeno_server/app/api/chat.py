import asyncio
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from app.core.database import get_db
from app.api.deps import get_current_user
from app.services.retrieval import retrieve_for_video
from app.services.llm import get_llm
from app.services.pinecone_db import get_pinecone_index
from app.models.schemas import ChatRequest, ChatResponse, VideoSource
from app.core.config import settings
import json

router = APIRouter()

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"

@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db)
):
    user_id = str(current_user["id"])
    context, sources = await asyncio.to_thread(
        retrieve_for_video, user_id, req.video_id, req.query
    )
    if not context:
        return ChatResponse(
            answer="This topic is not covered in this video.",
            sources=[],
            model=settings.model_name
        )
    result = await get_llm().ainvoke(context)
    return ChatResponse(
        answer=result.content,
        sources=[VideoSource(**s) for s in sources],
        model=settings.model_name
    )

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"

@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db)
):
    user_id = str(current_user["id"])

    async def generate():
        if not req.video_id:
            yield _sse({'type': 'token', 'content': 'No video selected.'})
            yield _sse({'type': 'done', 'model': settings.model_name})
            return

        context, sources = await asyncio.to_thread(
            retrieve_for_video, user_id, req.video_id, req.query
        )

        yield _sse({'type': 'sources', 'sources': sources})

        if not context:
            yield _sse({'type': 'token', 'content': 'Topic not found in this video.'})
            yield _sse({'type': 'done', 'model': settings.model_name})
            return

        prompt = f"Answer from this transcript only:\n\n{context}\n\nQuestion: {req.query}"
        llm = get_llm(streaming=True)
        full = []

        try:
            async for chunk in llm.astream(prompt):
                if chunk.content:
                    full.append(chunk.content)
                    yield _sse({'type': 'token', 'content': chunk.content})
            yield _sse({'type': 'done', 'model': settings.model_name})

            async with db.acquire() as conn:
                await conn.execute(
                    "INSERT INTO query_history (user_id, video_id, query, answer, sources_count, mode)"
                    " VALUES ($1::uuid, $2, $3, $4, $5, $6)",
                    user_id, req.video_id, req.query,
                    "".join(full), len(sources), req.mode,
                )
        except Exception as e:
            yield _sse({'type': 'error', 'detail': str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )