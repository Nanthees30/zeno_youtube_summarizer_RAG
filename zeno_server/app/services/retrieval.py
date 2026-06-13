import asyncio
from typing import Tuple, List
from app.services.pinecone_db import query_namespace
from app.core.config import settings

MIN_SIMILARITY = 0.3

def retrieve_for_video(
    user_id: str,
    video_id: str,
    query: str
) -> Tuple[str, list]:
    results = query_namespace(user_id, video_id, query)

    sources = []
    context_parts = []
    seen = set()

    for doc, score in results:
        if score < MIN_SIMILARITY:
            continue

        key = doc.page_content[:80]
        if key in seen:
            continue
        seen.add(key)

        m = doc.metadata
        context_parts.append(
            f"[{m.get('title','Video')} at {m.get('timestamp','0:00')}]:"
            f" {doc.page_content}"
        )
        sources.append({
            "video_id":      m.get("video_id", ""),
            "title":         m.get("title", ""),
            "timestamp":     m.get("timestamp", "0:00"),
            "start_seconds": float(m.get("start_seconds", 0)),
            "content":       doc.page_content[:400],
            "score":         score,
        })

    context = "\n\n---\n\n".join(context_parts)
    return context, sources