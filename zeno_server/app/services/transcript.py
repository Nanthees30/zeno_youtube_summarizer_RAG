import asyncio
from typing import List
from langchain_core.documents import Document
from youtube_transcript_api import YouTubeTranscriptApi
from app.core.config import settings
from app.services.embeddings import get_tokenizer

def seconds_to_timestamp(secs: float) -> str:
    secs = int(secs)
    h, rem = divmod(secs, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"

async def fetch_transcript(video_id: str) -> list:
    def _fetch():
        ytt = YouTubeTranscriptApi()
        t = ytt.fetch(video_id, languages=["en", "ta", "hi", "en-US", "en-GB"])
        return [{"text": s.text, "start": s.start} for s in t]
    return await asyncio.to_thread(_fetch)

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