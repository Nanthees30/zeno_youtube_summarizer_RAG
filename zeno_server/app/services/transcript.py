import asyncio
import httpx
from typing import List
from langchain_core.documents import Document
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import WebshareProxyConfig
from app.core.config import settings
from app.services.embeddings import get_tokenizer


def seconds_to_timestamp(secs: float) -> str:
    secs = int(secs)
    h, rem = divmod(secs, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


async def _fetch_via_supadata(video_id: str) -> list:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            "https://api.supadata.ai/v1/youtube/transcript",
            params={"videoId": video_id},
            headers={"x-api-key": settings.supadata_api_key},
        )
        if r.status_code == 404:
            raise ValueError("No transcript available for this video.")
        r.raise_for_status()
        data = r.json()
        segments = data.get("content") or []
        if not segments:
            raise ValueError("No transcript available for this video.")
        return [
            {
                "text": seg["text"],
                "start": seg.get("offset", 0) / 1000,
            }
            for seg in segments
        ]

async def fetch_transcript(video_id: str):
    # 1. First try standard youtube-transcript-api
    try:
        segments = YouTubeTranscriptApi.get_transcript(video_id)
        return [
            {
                "text": s["text"],
                "start": s["start"],
                "duration": s.get("duration", 0)
            }
            for s in segments
        ]
    except Exception as primary_error:
        # 2. Fallback: Supadata API (Bypasses YouTube Cloud IP Bans)
        if settings.supadata_api_key:
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(
                        "https://api.supadata.ai/v1/youtube/transcript",
                        params={"videoId": video_id, "lang": "en"},
                        headers={"x-api-key": settings.supadata_api_key},
                        timeout=15.0
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        content = data.get("content", [])
                        if content:
                            return [
                                {
                                    "text": item.get("text", ""),
                                    "start": float(item.get("start", 0)) / 1000.0 if float(item.get("start", 0)) > 1000 else float(item.get("start", 0)),
                                    "duration": float(item.get("duration", 0)) / 1000.0 if float(item.get("duration", 0)) > 1000 else float(item.get("duration", 0))
                                }
                                for item in content
                            ]
            except Exception:
                pass

        # Clean User-Friendly Error Message
        raise RuntimeError("Could not fetch transcript for this video. Please ensure the video has English captions enabled.")


def chunk_transcript(
    segments: list,
    metadata: dict,
    chunk_size: int = 512,
    overlap: int = 64,
) -> List[Document]:
    tokenizer = get_tokenizer()
    chunks, cur_text, cur_start = [], "", 0.0

    for seg in segments:
        text = seg["text"].strip().replace("\n", " ")
        if not text:
            continue
        candidate = (cur_text + " " + text).strip() if cur_text else text
        token_count = len(tokenizer.encode(candidate))

        if cur_text and token_count > chunk_size:
            chunks.append(Document(
                page_content=cur_text,
                metadata={**metadata, "timestamp": seconds_to_timestamp(cur_start), "start_seconds": cur_start}
            ))
            overlap_toks = tokenizer.encode(cur_text)[-overlap:]
            cur_text = tokenizer.decode(overlap_toks) + " " + text
            cur_start = seg["start"]
        else:
            if not cur_text:
                cur_start = seg["start"]
            cur_text = candidate

    if cur_text:
        chunks.append(Document(
            page_content=cur_text,
            metadata={**metadata, "timestamp": seconds_to_timestamp(cur_start), "start_seconds": cur_start}
        ))
    return chunks