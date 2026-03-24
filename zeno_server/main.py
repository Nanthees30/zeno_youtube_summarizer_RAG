"""
Zeno RAG Server v3.3 — YouTube Transcript Pipeline

Architecture:
  Auth:    Manual username/password → JWT session
  Input:   YouTube URL → transcript → FAISS per video
  Storage: faiss_index/{user_id}/{video_id}/
  DB:      PostgreSQL — users, videos, query_history
  RAG:     HuggingFace all-MiniLM-L6-v2 + FAISS + Groq llama-3.1-8b-instant

Fixes applied (v3.1):
  #1  FAISS search wrapped in asyncio.to_thread (non-blocking)
  #2  save_local() wrapped in asyncio.to_thread
  #3  get_embeddings() double-checked locking (thread-safe)
  #4  Empty context returns early — no LLM call with fake context
  #5  /video-status accepts optional video_id for per-video polling
  #6  load_user_video_indices safe (runs inside to_thread via Fix #1)
  #7  query_history table + INSERT include video_id column
  #8  mode field now branches: RAG_PROMPT (chain) vs AGENT_PROMPT (agent)
  #9  chunk_transcript: 64-token overlap added (no more boundary loss)
  #10 chunk_transcript: token-based sizing via tiktoken (was char-based)
  #11 retrieve_across_videos: k=settings.top_k (was hardcoded k=3)
  #12 _build_sources: MIN_SIMILARITY=0.3 threshold filters garbage chunks
  #13 _build_sources: shared helper — zero duplication between retrieve fns
  #14 Removed redundant ALTER TABLE migrations (columns in CREATE TABLE)
  #15 (responsive layout) — handled in index.css / ChatPage.jsx
  #16 ChatRequest.query: Field(min_length=1, max_length=2000)

Fixes applied (v3.2) — Multi-tenant privacy + security hardening:
  #17 Video ownership check in /chat and /chat/stream before FAISS query
  #18 _user_indexing_count now guarded by _indices_lock (was unprotected)
  #19 GET /query-history limit capped at 200 via Query(ge=1, le=200)
  #20 Visual mode prompts: CLASSIFIER_PROMPT, VISUAL_PROMPT added
  #21 build_classifier_prompt / build_rag_prompt / build_visual_prompt helpers
  #22 agent mode in /chat and /chat/stream: classify → retrieve → pick prompt

Fixes applied (v3.3) — Agent prompt upgrade + security:
  #23 ChatRequest.video_id: Field(pattern=...) — path traversal prevented
  #24 Unified AGENT_PROMPT with conversation history (replaces 3-prompt approach)
  #25 ChatRequest.history: passes last 3 exchanges to LLM for follow-up context
  #26 _assert_video_owned → _get_owned_video (returns title+channel for prompt)
  #27 /chat and /chat/stream simplified — single LLM call, no classifier step
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import threading

import numpy as np
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import asyncpg
import httpx
import tiktoken
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from jose import JWTError, jwt
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import WebshareProxyConfig, GenericProxyConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger("zeno")

# Rate limiter
_limiter = Limiter(key_func=get_remote_address, default_limits=[])


# Numpy-safe JSON encoder
class _NumpySafeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, cls=_NumpySafeEncoder)}\n\n"


# Settings
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    groq_api_key:     str
    faiss_index_path: str = "faiss_index"
    chunk_size:       int = 512
    chunk_overlap:    int = 64
    top_k:            int = 3
    model_name:       str = "llama-3.1-8b-instant"
    embedding_model:  str = "sentence-transformers/all-MiniLM-L6-v2"
    allowed_origins:  str = "http://localhost:5173,http://localhost:3000"

    google_client_id: str = ""
    jwt_secret_key:   str
    jwt_algorithm:    str = "HS256"
    jwt_expire_hours: int = 24

    database_url: str
    proxy_url:               str = ""
    webshare_proxy_username: str = ""
    webshare_proxy_password: str = ""
    supadata_api_key:        str = ""


settings = Settings()


# Database
_db_pool: Optional[asyncpg.Pool] = None


def get_db() -> asyncpg.Pool:
    return _db_pool


async def init_db() -> None:
    global _db_pool
    _db_pool = await asyncpg.create_pool(
        settings.database_url, min_size=2, max_size=10
    )
    async with _db_pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                username      TEXT        UNIQUE NOT NULL,
                email         TEXT        UNIQUE NOT NULL,
                name          TEXT,
                password_hash TEXT,
                google_id     TEXT        UNIQUE,
                created_at    TIMESTAMPTZ DEFAULT NOW(),
                last_login    TIMESTAMPTZ DEFAULT NOW(),
                query_count   INTEGER     DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS videos (
                id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                video_id    TEXT        NOT NULL,
                title       TEXT,
                channel     TEXT,
                thumbnail   TEXT,
                chunk_count INTEGER     DEFAULT 0,
                status      TEXT        DEFAULT 'processing',
                error_msg   TEXT,
                indexed_at  TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(user_id, video_id)
            );

            CREATE TABLE IF NOT EXISTS query_history (
                id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                video_id      TEXT,
                query         TEXT        NOT NULL,
                answer        TEXT,
                sources_count INTEGER     DEFAULT 0,
                mode          TEXT        DEFAULT 'chain',
                created_at    TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        await conn.execute(
            "ALTER TABLE query_history ADD COLUMN IF NOT EXISTS video_id TEXT"
        )
    log.info("Database tables ready")


# JWT auth
_bearer = HTTPBearer(auto_error=False)   # C-2: returns 401 not 403 when header missing
_ph = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2)


def create_access_token(user_id: str, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    return jwt.encode(
        {"sub": user_id, "email": email, "exp": expire},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


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
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(401, "Invalid token payload")
    except JWTError:
        raise HTTPException(401, "Invalid or expired token")

    async with db.acquire() as conn:
        user = await conn.fetchrow("SELECT * FROM users WHERE id = $1::uuid", user_id)
    if user is None:
        raise HTTPException(401, "User not found")
    return dict(user)


# Embeddings singleton
_embeddings: Optional[HuggingFaceEmbeddings] = None
_embeddings_lock = threading.Lock()


def get_embeddings() -> HuggingFaceEmbeddings:
    global _embeddings
    if _embeddings is None:
        with _embeddings_lock:
            if _embeddings is None:
                log.info(f"Loading embedding model: {settings.embedding_model}")
                _embeddings = HuggingFaceEmbeddings(model_name=settings.embedding_model)
    return _embeddings


# LLM singleton
_llm: Optional[ChatGroq] = None
_llm_streaming: Optional[ChatGroq] = None
_llm_lock = threading.Lock()


def get_llm(streaming: bool = False) -> ChatGroq:
    global _llm, _llm_streaming
    if streaming:
        if _llm_streaming is None:
            with _llm_lock:
                if _llm_streaming is None:
                    _llm_streaming = ChatGroq(
                        api_key=settings.groq_api_key,
                        model=settings.model_name,
                        temperature=0,
                        streaming=True,
                    )
        return _llm_streaming
    else:
        if _llm is None:
            with _llm_lock:
                if _llm is None:
                    _llm = ChatGroq(
                        api_key=settings.groq_api_key,
                        model=settings.model_name,
                        temperature=0,
                        streaming=False,
                    )
        return _llm


# ── Query result cache (in-memory LRU with TTL) ────────────────────────────────
import time as _time
from collections import OrderedDict

_CACHE_TTL    = 300          # seconds — cached answers expire after 5 minutes
_CACHE_MAX    = 500          # max entries per process
_query_cache: OrderedDict    = OrderedDict()
_cache_lock   = threading.Lock()


def _cache_key(user_id: str, video_id: str, query: str) -> str:
    """Stable key: user + video + lowercased, whitespace-normalised query."""
    return f"{user_id}:{video_id}:{' '.join(query.lower().split())}"


def _cache_get(key: str):
    with _cache_lock:
        entry = _query_cache.get(key)
        if entry is None:
            return None
        if _time.monotonic() - entry["ts"] > _CACHE_TTL:
            _query_cache.pop(key, None)
            return None
        _query_cache.move_to_end(key)          # LRU refresh
        return entry["value"]


def _cache_put(key: str, value) -> None:
    with _cache_lock:
        if key in _query_cache:
            _query_cache.move_to_end(key)
        _query_cache[key] = {"value": value, "ts": _time.monotonic()}
        while len(_query_cache) > _CACHE_MAX:
            _query_cache.popitem(last=False)   # evict oldest


# ── Per-user chat rate limiter (10 req/min, in-memory sliding window) ─────────
_CHAT_RATE_WINDOW = 60          # seconds
_CHAT_RATE_MAX    = 10          # requests per window
_chat_rate_store: Dict[str, list] = {}   # user_id → [timestamps]
_rate_store_lock = threading.Lock()


def _check_chat_rate(user_id: str) -> bool:
    """Return True if within rate limit, False if exceeded."""
    now = _time.monotonic()
    with _rate_store_lock:
        timestamps = _chat_rate_store.get(user_id, [])
        # Drop timestamps outside the current window
        timestamps = [t for t in timestamps if now - t < _CHAT_RATE_WINDOW]
        if len(timestamps) >= _CHAT_RATE_MAX:
            _chat_rate_store[user_id] = timestamps
            return False
        timestamps.append(now)
        _chat_rate_store[user_id] = timestamps
        return True


# ── In-flight request deduplication ───────────────────────────────────────────
# Prevents the LLM from being called twice for the exact same concurrent query.
_inflight: Dict[str, asyncio.Future] = {}
_inflight_lock = asyncio.Lock()


# Tokenizer singleton
_tokenizer: Optional[tiktoken.Encoding] = None
_tokenizer_lock = threading.Lock()


def get_tokenizer() -> tiktoken.Encoding:
    global _tokenizer
    if _tokenizer is None:
        with _tokenizer_lock:
            if _tokenizer is None:
                _tokenizer = tiktoken.get_encoding("cl100k_base")
    return _tokenizer


# Per-user FAISS management
_user_video_indices:  Dict[str, Dict[str, FAISS]] = {}
_user_indexing_count: Dict[str, int] = {}
_indices_lock = threading.Lock()   # Fix #3, #18 — guards BOTH dicts


def _index_path(user_id: str, video_id: str) -> Path:
    return Path(settings.faiss_index_path) / user_id / video_id


def load_user_video_indices(user_id: str) -> None:
    """Lazily load all persisted FAISS indices for a user from disk."""
    user_dir = Path(settings.faiss_index_path) / user_id
    if not user_dir.exists():
        return

    with _indices_lock:
        if user_id not in _user_video_indices:
            _user_video_indices[user_id] = {}
        already_loaded = set(_user_video_indices[user_id].keys())

    for video_dir in user_dir.iterdir():
        if not video_dir.is_dir():
            continue
        vid = video_dir.name
        if vid in already_loaded:
            continue
        try:
            store = FAISS.load_local(
                str(video_dir), get_embeddings(),
                allow_dangerous_deserialization=True,
            )
            with _indices_lock:
                _user_video_indices[user_id][vid] = store
            log.info(f"[{user_id[:8]}] Loaded FAISS for video {vid}")
        except Exception as e:
            log.error(f"[{user_id[:8]}] Failed to load FAISS for {vid}: {e}")


# ── Source builder
MIN_SIMILARITY: float = 0.3


def _build_sources(
    all_results: list[tuple[Document, float]],
    limit: Optional[int] = None,
) -> Tuple[str, list]:
    sources, context_parts, seen = [], [], set()
    results = all_results[:limit] if limit else all_results
    for doc, similarity in results:
        if similarity < MIN_SIMILARITY:
            continue
        key = doc.page_content[:80]
        if key in seen:
            continue
        seen.add(key)
        m = doc.metadata
        sources.append({
            "video_id":      m.get("video_id", ""),
            "title":         m.get("title", "Unknown"),
            "channel":       m.get("channel", ""),
            "thumbnail":     m.get("thumbnail", ""),
            "timestamp":     m.get("timestamp", "0:00"),
            "start_seconds": float(m.get("start_seconds", 0)),
            "content":       doc.page_content[:400],
            "score":         float(similarity),
        })
        context_parts.append(
            f"[{m.get('title', 'Video')} at {m.get('timestamp', '0:00')}]:"
            f" {doc.page_content}"
        )
    return "\n\n---\n\n".join(context_parts), sources


def retrieve_for_video(user_id: str, video_id: str, query: str) -> Tuple[str, list]:
    """
    Search only the specified video's FAISS index.
    Runs inside asyncio.to_thread() — blocking FAISS I/O is safe here.
    """
    # 1. Fast path: memory
    with _indices_lock:
        store = _user_video_indices.get(user_id, {}).get(video_id)

    # 2. Disk fallback
    if store is None:
        path = _index_path(user_id, video_id)
        if not path.exists() or not (path / "index.faiss").exists():
            log.warning(
                f"[{user_id[:8]}] No FAISS index on disk for video {video_id}"
            )
            return "", []
        try:
            log.info(f"[{user_id[:8]}] Loading FAISS from disk for video {video_id}")
            store = FAISS.load_local(
                str(path), get_embeddings(),
                allow_dangerous_deserialization=True,
            )
            with _indices_lock:
                if user_id not in _user_video_indices:
                    _user_video_indices[user_id] = {}
                _user_video_indices[user_id][video_id] = store
            log.info(f"[{user_id[:8]}] FAISS cached for video {video_id} ✓")
        except Exception as e:
            log.error(f"[{user_id[:8]}] Failed to load FAISS for {video_id}: {e}")
            return "", []
    else:
        log.debug(f"[{user_id[:8]}] FAISS for {video_id} served from memory")

    # 3. Search
    all_results: list[tuple[Document, float]] = []
    try:
        for doc, raw_score in store.similarity_search_with_score(query, k=settings.top_k):
            similarity = round(min(1.0, max(0.0, 1.0 - raw_score / 2.0)), 3)
            all_results.append((doc, similarity))
    except Exception as e:
        log.error(f"[{user_id[:8]}] Search error for {video_id}: {e}")

    all_results.sort(key=lambda x: x[1], reverse=True)
    return _build_sources(all_results)


# ── Fix #17: Video ownership guard ────────────────────────────────────────────
async def _get_owned_video(
    user_id: str, video_id: str, db: asyncpg.Pool
) -> Tuple[str, str]:
    """
    Fix #17 — Verify that video_id belongs to user_id before any FAISS query.
    Returns (title, channel) for use in the agent prompt.
    Raises HTTP 403 if not found or not ready.
    """
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT title, channel FROM videos"
            " WHERE user_id=$1::uuid AND video_id=$2 AND status='ready'",
            user_id, video_id,
        )
    if not row:
        raise HTTPException(403, "Video not found or not ready")
    return row["title"] or "Unknown", row["channel"] or "Unknown"


# ── YouTube utilities ──────────────────────────────────────────────────────────
def extract_video_id(url: str) -> Optional[str]:
    match = re.search(
        r'(?:youtube\.com/(?:watch\?v=|embed/|v/|shorts/)|youtu\.be/)([a-zA-Z0-9_-]{11})',
        url,
    )
    return match.group(1) if match else None


async def fetch_video_metadata(video_id: str) -> dict:
    url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url)
    if resp.status_code != 200:
        raise HTTPException(400, "Could not fetch video info. The video may be private or unavailable.")
    data = resp.json()
    return {
        "video_id":  video_id,
        "title":     data.get("title", "Unknown Title"),
        "channel":   data.get("author_name", "Unknown Channel"),
        "thumbnail": data.get(
            "thumbnail_url",
            f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg",
        ),
    }


async def fetch_transcript(video_id: str) -> list:
    _LANG_PREF = ["en", "en-US", "en-GB", "ta", "hi", "te", "kn", "ml", "mr", "bn"]

    def _fetch() -> list:
        # Build proxy config (v1.2.4 uses proxy_config=, NOT proxies= dict).
        # Priority: webshare credentials > proxy_url > no proxy.
        proxy_config = None
        if settings.webshare_proxy_username and settings.webshare_proxy_password:
            # WebshareProxyConfig adds -rotate suffix, sets Connection:close,
            # and auto-retries up to 10x on blocked responses.
            proxy_config = WebshareProxyConfig(
                proxy_username=settings.webshare_proxy_username,
                proxy_password=settings.webshare_proxy_password,
            )
        elif settings.proxy_url:
            from urllib.parse import urlparse
            parsed = urlparse(settings.proxy_url)
            if parsed.hostname and "webshare.io" in parsed.hostname:
                proxy_config = WebshareProxyConfig(
                    proxy_username=parsed.username,
                    proxy_password=parsed.password,
                )
            else:
                proxy_config = GenericProxyConfig(
                    http_url=settings.proxy_url,
                    https_url=settings.proxy_url,
                )
        ytt = YouTubeTranscriptApi(proxy_config=proxy_config)

        # ── Fast path: request preferred languages directly ────────────────
        try:
            t = ytt.fetch(video_id, languages=_LANG_PREF)
            return [{"text": s.text, "start": s.start, "duration": s.duration} for s in t]
        except Exception:
            pass

        # ── Slow path: enumerate all available transcripts ─────────────────
        tlist = ytt.list(video_id)
        transcript = None

        # 1) Try each preferred language (manual transcripts)
        for lang in _LANG_PREF:
            try:
                transcript = tlist.find_transcript([lang])
                break
            except Exception:
                continue

        # 2) Try auto-generated (YouTube auto-captions) in preferred languages
        if transcript is None:
            try:
                transcript = tlist.find_generated_transcript(_LANG_PREF)
            except Exception:
                pass

        # 3) Last resort: take whatever is first in the list
        if transcript is None:
            try:
                transcript = next(iter(tlist))
            except StopIteration:
                raise ValueError("No transcript available for this video.")

        t = transcript.fetch()
        return [{"text": s.text, "start": s.start, "duration": s.duration} for s in t]

    async def _fetch_via_supadata() -> list:
        """Fallback: fetch transcript via Supadata API (handles YouTube IP blocks)."""
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
            # Supadata returns offset/duration in milliseconds; convert to seconds.
            return [
                {
                    "text": seg["text"],
                    "start": seg.get("offset", 0) / 1000,
                    "duration": seg.get("duration", 0) / 1000,
                }
                for seg in segments
            ]

    def _classify_yt_error(e: Exception) -> ValueError:
        sig = (type(e).__name__ + " " + str(e)).lower()
        if "disabled" in sig or "transcriptsdisabled" in sig:
            return ValueError("Transcripts are disabled for this video.")
        if "unavailable" in sig or "videounavailable" in sig or "private" in sig:
            return ValueError("Video is unavailable or private.")
        if "blocked" in sig or "toomanyrequests" in sig or "429" in sig or "ratelimit" in sig:
            return ValueError("YouTube is blocking transcript requests. Try again in a few minutes.")
        if "notranscript" in sig or "couldnotretrieve" in sig or "no transcript" in sig:
            return ValueError("No transcript found for this video.")
        return ValueError(f"Could not fetch transcript: {e}")

    try:
        return await asyncio.to_thread(_fetch)
    except ValueError as e:
        # If YouTube blocked us and Supadata is configured, use it as fallback.
        if "blocking" in str(e).lower() and settings.supadata_api_key:
            log.info(f"[{video_id}] YouTube blocked direct request — falling back to Supadata")
            return await _fetch_via_supadata()
        raise
    except Exception as e:
        classified = _classify_yt_error(e)
        # If it's a blocking error and Supadata is configured, try fallback.
        if "blocking" in str(classified).lower() and settings.supadata_api_key:
            log.info(f"[{video_id}] YouTube blocked direct request — falling back to Supadata")
            return await _fetch_via_supadata()
        raise classified


def seconds_to_timestamp(secs: float) -> str:
    secs = int(secs)
    h, rem = divmod(secs, 3600)
    m, s   = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def chunk_transcript(
    segments: list,
    metadata: dict,
    chunk_size: int = 512,
    overlap: int = 64,
) -> List[Document]:
    tokenizer = get_tokenizer()
    chunks: List[Document] = []
    cur_text  = ""
    cur_start = 0.0

    def _make_doc(text: str, start: float) -> Document:
        return Document(
            page_content=text,
            metadata={
                "video_id":      metadata["video_id"],
                "title":         metadata["title"],
                "channel":       metadata["channel"],
                "thumbnail":     metadata["thumbnail"],
                "timestamp":     seconds_to_timestamp(start),
                "start_seconds": start,
            },
        )

    for seg in segments:
        text = seg["text"].strip().replace("\n", " ")
        if not text:
            continue

        candidate   = (cur_text + " " + text).strip() if cur_text else text
        token_count = len(tokenizer.encode(candidate))

        if cur_text and token_count > chunk_size:
            chunks.append(_make_doc(cur_text, cur_start))
            cur_tokens   = tokenizer.encode(cur_text)
            overlap_toks = cur_tokens[-overlap:] if len(cur_tokens) > overlap else cur_tokens
            overlap_text = tokenizer.decode(overlap_toks)
            cur_text     = (overlap_text + " " + text).strip()
            cur_start    = seg["start"]
        else:
            if not cur_text:
                cur_start = seg["start"]
            cur_text = candidate

    if cur_text:
        chunks.append(_make_doc(cur_text, cur_start))

    return chunks


# ── Background video indexing ──────────────────────────────────────────────────
async def _process_video(
    video_id: str, metadata: dict, user_id: str, db_id: str, db: asyncpg.Pool
) -> None:
    # Fix #18 — _indices_lock guards _user_indexing_count write
    with _indices_lock:
        _user_indexing_count[user_id] = _user_indexing_count.get(user_id, 0) + 1

    try:
        segments = await fetch_transcript(video_id)
        chunks   = chunk_transcript(segments, metadata, settings.chunk_size, settings.chunk_overlap)
        log.info(f"[{user_id[:8]}] {len(chunks)} chunks for video {video_id}")

        emb  = get_embeddings()
        path = _index_path(user_id, video_id)
        path.mkdir(parents=True, exist_ok=True)

        store = await asyncio.to_thread(FAISS.from_documents, chunks, emb)
        await asyncio.to_thread(store.save_local, str(path))

        with _indices_lock:
            if user_id not in _user_video_indices:
                _user_video_indices[user_id] = {}
            _user_video_indices[user_id][video_id] = store

        async with db.acquire() as conn:
            await conn.execute(
                "UPDATE videos SET chunk_count=$1, status='ready', error_msg=NULL WHERE id=$2::uuid",
                len(chunks), db_id,
            )
        log.info(f"[{user_id[:8]}] Video {video_id} indexed — {len(chunks)} chunks ✓")

    except ValueError as e:
        log.error(f"[{user_id[:8]}] Transcript error for {video_id}: {e}")
        async with db.acquire() as conn:
            await conn.execute(
                "UPDATE videos SET status='failed', error_msg=$1 WHERE id=$2::uuid",
                str(e), db_id,
            )
    except Exception as e:
        log.error(f"[{user_id[:8]}] Indexing error for {video_id}: {e}", exc_info=True)
        async with db.acquire() as conn:
            await conn.execute(
                "UPDATE videos SET status='failed', error_msg=$1 WHERE id=$2::uuid",
                f"Indexing error: {e}", db_id,
            )
    finally:
        # Fix #18 — _indices_lock guards _user_indexing_count decrement
        with _indices_lock:
            _user_indexing_count[user_id] = max(
                0, _user_indexing_count.get(user_id, 0) - 1
            )


# ── Prompts ────────────────────────────────────────────────────────────────────

AGENT_PROMPT = """\
You are Zeno, a YouTube video analyst. You answer questions ONLY from the transcript of the user's video. Never use external knowledge or invent timestamps.

Video: {video_title} | Channel: {video_channel}

TRANSCRIPT (retrieved chunks):
{rag_context}

CONVERSATION HISTORY:
{conversation_history}

USER QUESTION: {query}

RULES:
- Answer from transcript only. Cite [Video Title at MM:SS].
- If topic not in transcript: "⚠️ This topic is not covered in "{video_title}". Please ask about the video content."
- For visuals/diagrams: <explanation>...</explanation><visual>[inline-CSS HTML]</visual><source>transcript</source>
- For follow-ups: resolve pronouns from history, cite new timestamp if applicable.
- Reply in the same language as the user (English/Tamil/Tanglish).
- Keep answers concise (3-5 sentences). Do NOT reveal other users' data.\
"""


def build_agent_prompt(
    query: str,
    rag_context: str,
    video_title: str,
    video_channel: str,
    history: list,
) -> str:
    history_text = ""
    if history:
        lines = []
        for msg in history[-6:]:   # last 3 exchanges (user + assistant pairs)
            role    = "User" if msg.get("role") == "user" else "Zeno"
            content = str(msg.get("content", "")).strip()
            if content:
                lines.append(f"{role}: {content}")
        history_text = "\n".join(lines)
    return (
        AGENT_PROMPT
        .replace("{query}",                query)
        .replace("{rag_context}",          rag_context or "No transcript context available.")
        .replace("{video_title}",          video_title or "Unknown")
        .replace("{video_channel}",        video_channel or "Unknown")
        .replace("{conversation_history}", history_text or "No previous conversation.")
    )


# ── Pydantic models ────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str
    email:    str
    password: str
    name:     Optional[str] = None


class LoginRequest(BaseModel):
    email:    str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    user:         dict


class IndexVideoRequest(BaseModel):
    url: str


class ChatRequest(BaseModel):
    query:    str           = Field(..., min_length=1, max_length=2000)
    mode:     str           = Field("chain", pattern="^(chain|agent)$")
    video_id: Optional[str] = Field(None, pattern=r'^[a-zA-Z0-9_-]{11}$')
    history:  List[dict]    = []


class VideoSource(BaseModel):
    video_id:      str
    title:         str
    channel:       str            = ""
    thumbnail:     str            = ""
    timestamp:     str
    start_seconds: float          = 0
    content:       str
    score:         Optional[float] = None


class ChatResponse(BaseModel):
    answer:  str
    sources: List[VideoSource]
    model:   str


# ── App lifespan ───────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    _key = settings.groq_api_key
    log.info(f"Groq API key loaded ({len(_key)} chars, prefix={_key[:7]}…)")
    log.info("Zeno v3.3 started — YouTube RAG pipeline")
    yield
    if _db_pool:
        await _db_pool.close()
    log.info("Zeno server stopped")


app = FastAPI(title="Zeno RAG API", version="3.3.0", lifespan=lifespan)

app.state.limiter = _limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.allowed_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth endpoints ─────────────────────────────────────────────────────────────
@app.post("/auth/register", response_model=TokenResponse)
@_limiter.limit("5/minute")
async def auth_register(
    request: Request,
    body: RegisterRequest,
    db: asyncpg.Pool = Depends(get_db),
):
    username = body.username.strip()
    email    = body.email.strip().lower()
    if not username or not email or not body.password:
        raise HTTPException(400, "username, email and password are required")
    try:
        if len(body.password.encode()) > 1024:
            raise HTTPException(400, "Password too long (max 1024 characters)")
        pw_hash = _ph.hash(body.password)
        display = body.name or username
        async with db.acquire() as conn:
            user = await conn.fetchrow(
                """
                INSERT INTO users (username, email, name, password_hash)
                VALUES ($1, $2, $3, $4)
                RETURNING *
                """,
                username, email, display, pw_hash,
            )
        if user is None:
            raise HTTPException(500, "Insert returned no row")
        user_id = str(user["id"])
        return TokenResponse(
            access_token=create_access_token(user_id, user["email"]),
            user={"id": user_id, "email": user["email"], "name": user["name"]},
        )
    except HTTPException:
        raise
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "Email or username already registered")
    except Exception as e:
        log.error(f"Register error: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(500, "Registration failed — please try again")


@app.post("/auth/login", response_model=TokenResponse)
@_limiter.limit("5/minute")
async def auth_login(
    request: Request,
    body: LoginRequest,
    db: asyncpg.Pool = Depends(get_db),
):
    email = body.email.strip().lower()
    async with db.acquire() as conn:
        user = await conn.fetchrow("SELECT * FROM users WHERE email = $1", email)
    if user is None or not user["password_hash"]:
        raise HTTPException(401, "Invalid email or password")
    try:
        _ph.verify(user["password_hash"], body.password)
    except VerifyMismatchError:
        raise HTTPException(401, "Invalid email or password")
    except VerificationError:
        log.error(f"Argon2 VerificationError for {email}", exc_info=True)
        raise HTTPException(500, "Authentication error — please try again")

    async with db.acquire() as conn:
        await conn.execute("UPDATE users SET last_login=NOW() WHERE id=$1", user["id"])

    user_id = str(user["id"])
    # H-4: fire-and-forget FAISS pre-warm — does not block login response
    asyncio.create_task(asyncio.to_thread(load_user_video_indices, user_id))
    return TokenResponse(
        access_token=create_access_token(user_id, user["email"]),
        user={"id": user_id, "email": user["email"], "name": user["name"]},
    )


@app.get("/auth/me")
async def auth_me(current_user: dict = Depends(get_current_user)):
    u = current_user
    return {
        "id":          str(u["id"]),
        "email":       u["email"],
        "name":        u["name"],
        "query_count": u["query_count"],
        "created_at":  u["created_at"].isoformat() if u.get("created_at") else None,
    }


@app.post("/auth/refresh", response_model=TokenResponse)
async def auth_refresh(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["id"])
    return TokenResponse(
        access_token=create_access_token(user_id, current_user["email"]),
        user={"id": user_id, "email": current_user["email"], "name": current_user["name"]},
    )


# ── Video endpoints ────────────────────────────────────────────────────────────
@app.post("/index-video")
async def index_video(
    body: IndexVideoRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Pool = Depends(get_db),
):
    user_id  = str(current_user["id"])
    video_id = extract_video_id(body.url)
    if not video_id:
        raise HTTPException(
            400,
            "Invalid YouTube URL. Accepted: youtube.com/watch?v=, youtu.be/, youtube.com/shorts/",
        )

    async with db.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT id, status FROM videos WHERE user_id=$1::uuid AND video_id=$2",
            user_id, video_id,
        )
    if existing and existing["status"] == "ready":
        return {"message": "Video already indexed", "video_id": video_id, "already_indexed": True}

    metadata = await fetch_video_metadata(video_id)

    async with db.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO videos (user_id, video_id, title, channel, thumbnail)
            VALUES ($1::uuid, $2, $3, $4, $5)
            ON CONFLICT (user_id, video_id) DO UPDATE
              SET status='processing', error_msg=NULL,
                  title=EXCLUDED.title, channel=EXCLUDED.channel,
                  thumbnail=EXCLUDED.thumbnail, indexed_at=NOW()
            RETURNING id
            """,
            user_id, video_id, metadata["title"], metadata["channel"], metadata["thumbnail"],
        )
    db_id = str(row["id"])

    background_tasks.add_task(_process_video, video_id, metadata, user_id, db_id, db)
    log.info(f"[{user_id[:8]}] Queued: {metadata['title']!r} ({video_id})")

    return {
        "message":         "Video indexing started",
        "video_id":        video_id,
        "title":           metadata["title"],
        "thumbnail":       metadata["thumbnail"],
        "already_indexed": False,
    }


@app.get("/video-status")
async def video_status(
    video_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Pool = Depends(get_db),
):
    user_id = str(current_user["id"])

    if video_id:
        async with db.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT status, error_msg FROM videos WHERE user_id=$1::uuid AND video_id=$2",
                user_id, video_id,
            )
        if not row:
            return {"ready": False, "indexing": False, "failed": False, "total": 0, "ready_count": 0}
        ready    = row["status"] == "ready"
        indexing = row["status"] == "processing"
        failed   = row["status"] == "failed"
        return {
            "ready":       ready,
            "indexing":    indexing,
            "failed":      failed,
            "error_msg":   row["error_msg"] if failed else None,
            "total":       1,
            "ready_count": 1 if ready else 0,
        }

    async with db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT status FROM videos WHERE user_id=$1::uuid", user_id
        )
    ready_count = sum(1 for r in rows if r["status"] == "ready")

    # Fix #18: lock to safely read _user_indexing_count
    with _indices_lock:
        indexing_count = _user_indexing_count.get(user_id, 0)

    return {
        "ready":       ready_count > 0,
        "indexing":    indexing_count > 0,
        "total":       len(rows),
        "ready_count": ready_count,
    }


@app.get("/videos")
async def list_videos(
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Pool = Depends(get_db),
):
    user_id = str(current_user["id"])
    async with db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, video_id, title, channel, thumbnail, chunk_count, status,"
            "       error_msg, indexed_at"
            " FROM videos WHERE user_id=$1::uuid ORDER BY indexed_at DESC",
            user_id,
        )
    return [
        {
            "id":          str(r["id"]),
            "video_id":    r["video_id"],
            "title":       r["title"],
            "channel":     r["channel"],
            "thumbnail":   r["thumbnail"],
            "chunk_count": r["chunk_count"],
            "status":      r["status"],
            "error_msg":   r["error_msg"],
            "indexed_at":  r["indexed_at"].isoformat(),
        }
        for r in rows
    ]


@app.delete("/videos/{video_id}")
async def delete_video(
    video_id: str,
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Pool = Depends(get_db),
):
    user_id = str(current_user["id"])

    # M-1: validate video_id format before touching filesystem
    if not re.fullmatch(r'[a-zA-Z0-9_-]{11}', video_id):
        raise HTTPException(400, "Invalid video ID format")

    async with db.acquire() as conn:
        deleted = await conn.fetchval(
            "DELETE FROM videos WHERE user_id=$1::uuid AND video_id=$2 RETURNING id",
            user_id, video_id,
        )
    if not deleted:
        raise HTTPException(404, "Video not found")

    with _indices_lock:
        if user_id in _user_video_indices:
            _user_video_indices[user_id].pop(video_id, None)

    # Evict all cached answers for this video so stale results aren't served
    prefix = f"{user_id}:{video_id}:"
    with _cache_lock:
        stale = [k for k in _query_cache if k.startswith(prefix)]
        for k in stale:
            _query_cache.pop(k, None)

    path = _index_path(user_id, video_id)
    if path.exists():
        await asyncio.to_thread(shutil.rmtree, str(path))

    log.info(f"[{user_id[:8]}] Deleted video {video_id}")
    return {"message": f"Video {video_id} removed"}


# ── Chat endpoints ─────────────────────────────────────────────────────────────
@app.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Pool = Depends(get_db),
):
    user_id = str(current_user["id"])

    if not req.video_id:
        return ChatResponse(
            answer="No video content available in this tab. Please add a YouTube video from the sidebar.",
            sources=[],
            model=settings.model_name,
        )

    # Fix #17 — verify ownership and fetch metadata for the agent prompt
    title, channel = await _get_owned_video(user_id, req.video_id, db)

    context, sources = await asyncio.to_thread(
        retrieve_for_video, user_id, req.video_id, req.query
    )
    prompt_text = build_agent_prompt(req.query, context, title, channel, req.history)

    result = await get_llm().ainvoke(prompt_text)
    answer = result.content

    async with db.acquire() as conn:
        await conn.execute(
            "INSERT INTO query_history (user_id, video_id, query, answer, sources_count, mode)"
            " VALUES ($1::uuid, $2, $3, $4, $5, $6)",
            user_id, req.video_id, req.query, answer, len(sources), req.mode,
        )
        await conn.execute(
            "UPDATE users SET query_count=query_count+1 WHERE id=$1::uuid", user_id
        )

    return ChatResponse(
        answer=answer,
        sources=[VideoSource(**s) for s in sources],
        model=settings.model_name,
    )


@app.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Pool = Depends(get_db),
):
    user_id = str(current_user["id"])

    if not req.video_id:
        async def _no_video():
            yield _sse({'type': 'sources', 'sources': []})
            yield _sse({'type': 'token', 'content': "No video content available in this tab. Please add a YouTube video from the sidebar."})
            yield _sse({'type': 'done', 'model': settings.model_name})
        return StreamingResponse(
            _no_video(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Per-user rate limit (10 queries/minute) — checked before any DB work
    if not _check_chat_rate(user_id):
        raise HTTPException(429, "Rate limit exceeded — max 10 queries per minute")

    # Fix #17 — verify ownership and fetch metadata for the agent prompt
    title, channel = await _get_owned_video(user_id, req.video_id, db)

    # ── Cache hit: return cached answer without hitting LLM ─────────────────
    ckey    = _cache_key(user_id, req.video_id, req.query)
    cached  = _cache_get(ckey)
    if cached:
        log.info(f"[{user_id[:8]}] Cache hit for query on {req.video_id}")
        async def _from_cache():
            yield _sse({'type': 'sources',  'sources': cached['sources']})
            yield _sse({'type': 'token',    'content': cached['answer']})
            yield _sse({'type': 'done',     'model':   settings.model_name, 'cached': True})
        return StreamingResponse(
            _from_cache(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Retrieve context BEFORE entering the streaming generator
    context, sources = await asyncio.to_thread(
        retrieve_for_video, user_id, req.video_id, req.query
    )
    prompt_text = build_agent_prompt(req.query, context, title, channel, req.history)

    async def generate():
        yield _sse({'type': 'sources', 'sources': sources})

        llm  = get_llm(streaming=True)
        full: list[str] = []

        try:
            async for chunk in llm.astream(prompt_text):
                if chunk.content:
                    full.append(chunk.content)
                    yield _sse({'type': 'token', 'content': chunk.content})

            full_answer = "".join(full)
            yield _sse({'type': 'done', 'model': settings.model_name})

            # Store in cache for future identical queries
            _cache_put(ckey, {'answer': full_answer, 'sources': sources})

            async with db.acquire() as conn:
                await conn.execute(
                    "INSERT INTO query_history (user_id, video_id, query, answer, sources_count, mode)"
                    " VALUES ($1::uuid, $2, $3, $4, $5, $6)",
                    user_id, req.video_id, req.query, full_answer, len(sources), req.mode,
                )
                await conn.execute(
                    "UPDATE users SET query_count=query_count+1 WHERE id=$1::uuid", user_id
                )

        except Exception as e:
            err_name = type(e).__name__
            log.error(f"[{user_id[:8]}] Stream error ({err_name}): {e}", exc_info=True)
            yield _sse({'type': 'error', 'detail': f"{err_name}: {e}"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Query history ──────────────────────────────────────────────────────────────
@app.get("/query-history")
async def query_history(
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Pool = Depends(get_db),
    # Fix #19 — cap limit to prevent DB overload (was uncapped)
    limit: int = Query(default=50, ge=1, le=200),
):
    user_id = str(current_user["id"])
    async with db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, video_id, query, answer, sources_count, mode, created_at"
            " FROM query_history WHERE user_id=$1::uuid ORDER BY created_at DESC LIMIT $2",
            user_id, limit,
        )
    return [
        {
            "id":            str(r["id"]),
            "video_id":      r["video_id"],
            "query":         r["query"],
            "answer":        r["answer"],
            "sources_count": r["sources_count"],
            "mode":          r["mode"],
            "created_at":    r["created_at"].isoformat(),
        }
        for r in rows
    ]


# ── Health check
@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"status": "ok",
             "model": settings.model_name,
             "version": "3.3.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)