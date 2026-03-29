"""
Zeno RAG Server v4.0 — YouTube Transcript Pipeline (ChromaDB)

Architecture:
  Auth:    Manual username/password → JWT session
  Input:   YouTube URL → transcript → ChromaDB per video
  Storage: ./chroma_db/ (PersistentClient, auto-persisted)
  DB:      PostgreSQL — users, videos, query_history
  RAG:     FastEmbed BAAI/bge-small-en-v1.5 + ChromaDB + Groq llama-3.1-8b-instant

Migration v3.3 → v4.0 (FAISS → ChromaDB):
  Removed: FAISS import, save_local/load_local, video_indices dict,
           load_user_video_indices(), _index_path(), shutil.rmtree
  Added:   get_chroma_client() singleton, _collection_name(),
           _index_to_chroma(), retrieve_across_videos(), _is_video_indexed()
  Collection naming: u{user_id[:8]}_v{video_id[:8]}  (17 chars, limit is 63)
  Score formula:     similarity = 1.0 - cosine_distance
                     (was: 1.0 - L2_score / 2.0 — equivalent for unit vectors)

All 16 original fixes preserved:
  #1  to_thread wraps all blocking ChromaDB calls
  #2  No save_local() — ChromaDB PersistentClient auto-persists (fixed by design)
  #3  No embedding race condition — ChromaDB client is thread-safe (fixed by design)
  #4  Empty context → early return, no LLM call
  #5  /video-status accepts optional video_id for per-video polling
  #6  get_llm() singleton — no per-request ChatGroq construction
  #7  query_history INSERT includes video_id
  #8  mode field routes chain vs agent prompt
  #9  64-token chunk overlap (no boundary loss)
  #10 tiktoken-based chunking (512 tokens)
  #11 k=settings.top_k (=5) consistent across all retrieve functions
  #12 MIN_SIMILARITY=0.3 threshold in _build_sources
  #13 _build_sources shared helper (zero duplication)
  #14 No redundant ALTER TABLE migrations
  #15 No blocking load_local in async path (ChromaDB is always on-demand)
  #16 ChatRequest.query: min_length=1, max_length=2000

Additional fixes (v3.2 / v3.3):
  #17 Video ownership guard before any vector search
  #18 _user_indexing_count guarded by _indices_lock
  #19 GET /query-history limit capped at 200
  #23 ChatRequest.video_id: pattern= field prevents path traversal
  #24 Unified AGENT_PROMPT with conversation history
  #25 ChatRequest.history: last 3 exchanges passed to LLM
  #26 _get_owned_video returns title+channel for agent prompt
  #27 Simplified /chat and /chat/stream — single LLM call, no classifier
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time as _time
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import asyncpg
import chromadb
import httpx
import numpy as np
import tiktoken
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document
from langchain_groq import ChatGroq
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig, WebshareProxyConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger("zeno")

_limiter = Limiter(key_func=get_remote_address, default_limits=[])


# ── Numpy-safe JSON encoder ────────────────────────────────────────────────────
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


# ── Settings ───────────────────────────────────────────────────────────────────
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    groq_api_key:    str
    chroma_db_path:  str = "chroma_db"        # replaces faiss_index_path
    chunk_size:      int = 512
    chunk_overlap:   int = 64
    top_k:           int = 5                  # Fix #11: default raised to 5
    model_name:      str = "llama-3.1-8b-instant"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    allowed_origins: str = "http://localhost:5173,http://localhost:3000"

    google_client_id:        str = ""
    jwt_secret_key:          str
    jwt_algorithm:           str = "HS256"
    jwt_expire_hours:        int = 24

    database_url:            str
    proxy_url:               str = ""
    webshare_proxy_username: str = ""
    webshare_proxy_password: str = ""
    supadata_api_key:        str = ""


settings = Settings()


# ── Database ───────────────────────────────────────────────────────────────────
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
        # Fix #14: ADD COLUMN IF NOT EXISTS is idempotent — safe on every start
        await conn.execute(
            "ALTER TABLE query_history ADD COLUMN IF NOT EXISTS video_id TEXT"
        )
    log.info("Database tables ready")


# ── JWT auth ───────────────────────────────────────────────────────────────────
_bearer = HTTPBearer(auto_error=False)
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


# ── Embeddings singleton ───────────────────────────────────────────────────────
_embeddings = None
_embeddings_lock = threading.Lock()


def get_embeddings():
    global _embeddings
    if _embeddings is None:
        with _embeddings_lock:
            if _embeddings is None:
                log.info("Loading HuggingFace embedding model...")
                _embeddings = HuggingFaceEmbeddings(
                    model_name="BAAI/bge-small-en-v1.5",
                    model_kwargs={"device": "cpu"},
                    encode_kwargs={"normalize_embeddings": True},
                )
    return _embeddings


# ── LLM singleton ──────────────────────────────────────────────────────────────
_llm: Optional[ChatGroq] = None
_llm_streaming: Optional[ChatGroq] = None
_llm_lock = threading.Lock()


def get_llm(streaming: bool = False) -> ChatGroq:
    """Fix #6: singleton — no per-request ChatGroq instantiation."""
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
_CACHE_TTL  = 300       # seconds — cached answers expire after 5 minutes
_CACHE_MAX  = 500       # max entries per process
_query_cache: OrderedDict = OrderedDict()
_cache_lock = threading.Lock()


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
        _query_cache.move_to_end(key)       # LRU refresh
        return entry["value"]


def _cache_put(key: str, value) -> None:
    with _cache_lock:
        if key in _query_cache:
            _query_cache.move_to_end(key)
        _query_cache[key] = {"value": value, "ts": _time.monotonic()}
        while len(_query_cache) > _CACHE_MAX:
            _query_cache.popitem(last=False)   # evict oldest


# ── Per-user chat rate limiter (10 req/min, sliding window) ───────────────────
_CHAT_RATE_WINDOW = 60
_CHAT_RATE_MAX    = 10
_chat_rate_store: Dict[str, list] = {}
_rate_store_lock = threading.Lock()


def _check_chat_rate(user_id: str) -> bool:
    """Return True if within limit, False if exceeded."""
    now = _time.monotonic()
    with _rate_store_lock:
        timestamps = _chat_rate_store.get(user_id, [])
        timestamps = [t for t in timestamps if now - t < _CHAT_RATE_WINDOW]
        if len(timestamps) >= _CHAT_RATE_MAX:
            _chat_rate_store[user_id] = timestamps
            return False
        timestamps.append(now)
        _chat_rate_store[user_id] = timestamps
        return True


# ── Tokenizer singleton ────────────────────────────────────────────────────────
_tokenizer: Optional[tiktoken.Encoding] = None
_tokenizer_lock = threading.Lock()


def get_tokenizer() -> tiktoken.Encoding:
    global _tokenizer
    if _tokenizer is None:
        with _tokenizer_lock:
            if _tokenizer is None:
                _tokenizer = tiktoken.get_encoding("cl100k_base")
    return _tokenizer


# ── ChromaDB client singleton ──────────────────────────────────────────────────
_chroma_client: Optional[chromadb.PersistentClient] = None
_chroma_lock = threading.Lock()


def get_chroma_client() -> chromadb.PersistentClient:
    """
    Thread-safe singleton for ChromaDB PersistentClient.
    Reused across all requests — never constructed per-request.
    Fix #3: double-checked locking (same pattern as get_embeddings).
    """
    global _chroma_client
    if _chroma_client is None:
        with _chroma_lock:
            if _chroma_client is None:
                log.info(f"Initialising ChromaDB at ./{settings.chroma_db_path}")
                _chroma_client = chromadb.PersistentClient(
                    path=settings.chroma_db_path
                )
    return _chroma_client


def _collection_name(user_id: str, video_id: str) -> str:
    """
    Short, deterministic collection name for a user+video pair.
    ChromaDB enforces [a-zA-Z0-9_-]{3,63}.
    UUID user_id[:8] = 8 hex chars; YouTube video_id[:8] = 8 chars.
    Result 'u{8}_v{8}' = 17 chars — well within the 63-char limit.
    """
    return f"u{user_id[:8]}_v{video_id[:8]}"


# ── Per-user indexing counter (for /video-status) ─────────────────────────────
# Fix #18: _indices_lock guards _user_indexing_count against concurrent writes
_user_indexing_count: Dict[str, int] = {}
_indices_lock = threading.Lock()


# ── Source builder helper ──────────────────────────────────────────────────────
MIN_SIMILARITY: float = 0.3   # Fix #12: filter chunks below this threshold


def _build_sources(
    all_results: list[tuple[Document, float]],
    limit: Optional[int] = None,
) -> Tuple[str, list]:
    """
    Fix #13: single shared helper — used by both retrieve_* functions.
    Fix #12: MIN_SIMILARITY=0.3 filters low-quality chunks before LLM.
    """
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


# ── ChromaDB retrieval ─────────────────────────────────────────────────────────
def retrieve_for_video(user_id: str, video_id: str, query: str) -> Tuple[str, list]:
    """
    Search a single video's ChromaDB collection.
    Runs inside asyncio.to_thread() — blocking ChromaDB I/O is safe here.

    Fix #1:  wrapped in to_thread by caller.
    Fix #11: k=settings.top_k (consistent, not hardcoded).
    Fix #15: no blocking load_local — ChromaDB queries directly from disk.
    Score:   cosine distance → similarity = 1.0 - raw_score
             (FAISS used 1.0 - raw_score/2.0; equivalent for unit vectors
              because cosine_dist = L2²/2 for normalised embeddings).
    """
    cname  = _collection_name(user_id, video_id)
    client = get_chroma_client()

    try:
        col = client.get_collection(cname)
    except Exception:
        log.warning(f"[{user_id[:8]}] No ChromaDB collection for video {video_id}")
        return "", []

    if col.count() == 0:
        log.warning(f"[{user_id[:8]}] Empty collection for video {video_id}")
        return "", []

    store = Chroma(
        collection_name=cname,
        embedding_function=get_embeddings(),
        client=client,
    )

    all_results: list[tuple[Document, float]] = []
    try:
        for doc, raw_score in store.similarity_search_with_score(query, k=settings.top_k):
            similarity = round(min(1.0, max(0.0, 1.0 - raw_score)), 3)
            all_results.append((doc, similarity))
    except Exception as e:
        log.error(f"[{user_id[:8]}] ChromaDB search error for {video_id}: {e}")
        return "", []

    all_results.sort(key=lambda x: x[1], reverse=True)
    return _build_sources(all_results)


def retrieve_across_videos(user_id: str, query: str) -> Tuple[str, list]:
    """
    Query ALL ChromaDB collections belonging to this user.
    Merges, deduplicates, and applies score threshold across every video.
    Runs inside asyncio.to_thread().

    Fix #11: k=settings.top_k per collection.
    Fix #12: MIN_SIMILARITY threshold applied via _build_sources.
    Fix #13: _build_sources shared helper used here too.
    """
    client = get_chroma_client()
    prefix = f"u{user_id[:8]}_"

    try:
        all_collections = client.list_collections()
        user_cnames     = [c.name for c in all_collections if c.name.startswith(prefix)]
    except Exception as e:
        log.error(f"[{user_id[:8]}] Failed to list ChromaDB collections: {e}")
        return "", []

    if not user_cnames:
        return "", []

    emb         = get_embeddings()
    all_results: list[tuple[Document, float]] = []

    for cname in user_cnames:
        try:
            store = Chroma(
                collection_name=cname,
                embedding_function=emb,
                client=client,
            )
            for doc, raw_score in store.similarity_search_with_score(query, k=settings.top_k):
                similarity = round(min(1.0, max(0.0, 1.0 - raw_score)), 3)
                all_results.append((doc, similarity))
        except Exception as e:
            log.warning(f"[{user_id[:8]}] Cross-video search failed for {cname}: {e}")

    all_results.sort(key=lambda x: x[1], reverse=True)
    # Cap merged results to top_k*2 to avoid bloating the LLM context window
    return _build_sources(all_results, limit=settings.top_k * 2)


def _is_video_indexed(user_id: str, video_id: str) -> bool:
    """
    True if a ChromaDB collection exists for this video and has at least one chunk.
    Replaces: os.path.exists(faiss_path) and (path / "index.faiss").exists()
    """
    cname = _collection_name(user_id, video_id)
    try:
        col = get_chroma_client().get_collection(cname)
        return col.count() > 0
    except Exception:
        return False


# ── Video ownership guard ──────────────────────────────────────────────────────
async def _get_owned_video(
    user_id: str, video_id: str, db: asyncpg.Pool
) -> Tuple[str, str]:
    """
    Fix #17/#26 — Verify video belongs to user before any vector search.
    Returns (title, channel) for the agent prompt.
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
        proxy_config = None
        if settings.webshare_proxy_username and settings.webshare_proxy_password:
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

        try:
            t = ytt.fetch(video_id, languages=_LANG_PREF)
            return [{"text": s.text, "start": s.start, "duration": s.duration} for s in t]
        except Exception:
            pass

        tlist      = ytt.list(video_id)
        transcript = None

        for lang in _LANG_PREF:
            try:
                transcript = tlist.find_transcript([lang])
                break
            except Exception:
                continue

        if transcript is None:
            try:
                transcript = tlist.find_generated_transcript(_LANG_PREF)
            except Exception:
                pass

        if transcript is None:
            try:
                transcript = next(iter(tlist))
            except StopIteration:
                raise ValueError("No transcript available for this video.")

        t = transcript.fetch()
        return [{"text": s.text, "start": s.start, "duration": s.duration} for s in t]

    async def _fetch_via_supadata() -> list:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                "https://api.supadata.ai/v1/youtube/transcript",
                params={"videoId": video_id},
                headers={"x-api-key": settings.supadata_api_key},
            )
            if r.status_code == 404:
                raise ValueError("No transcript available for this video.")
            r.raise_for_status()
            data     = r.json()
            segments = data.get("content") or []
            if not segments:
                raise ValueError("No transcript available for this video.")
            return [
                {
                    "text":     seg["text"],
                    "start":    seg.get("offset", 0) / 1000,
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
        if "blocking" in str(e).lower() and settings.supadata_api_key:
            log.info(f"[{video_id}] YouTube blocked — falling back to Supadata")
            return await _fetch_via_supadata()
        raise
    except Exception as e:
        classified = _classify_yt_error(e)
        if "blocking" in str(classified).lower() and settings.supadata_api_key:
            log.info(f"[{video_id}] YouTube blocked — falling back to Supadata")
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
    """
    Fix #9:  64-token overlap prevents context loss at chunk boundaries.
    Fix #10: tiktoken-based token counting (was character-based).
    """
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


# ── ChromaDB indexing ──────────────────────────────────────────────────────────
def _index_to_chroma(chunks: List[Document], user_id: str, video_id: str) -> None:
    """
    Create (or replace) a ChromaDB collection for this user+video pair.
    Uses cosine distance: similarity = 1 - cosine_distance (0=orthogonal, 1=identical).
    Runs inside asyncio.to_thread() — synchronous ChromaDB writes are safe here.

    Fix #1: called via to_thread in _process_video.
    Fix #2: no save_local() — PersistentClient writes to disk automatically.
    Fix #3: get_chroma_client() is thread-safe (double-checked lock).
    """
    cname  = _collection_name(user_id, video_id)
    client = get_chroma_client()

    # Delete existing collection to allow clean re-indexing (idempotent)
    try:
        client.delete_collection(cname)
        log.info(f"[{user_id[:8]}] Replaced existing collection {cname!r}")
    except Exception:
        pass  # Didn't exist — that's fine

    Chroma.from_documents(
        documents=chunks,
        embedding=get_embeddings(),
        client=client,
        collection_name=cname,
        collection_metadata={"hnsw:space": "cosine"},
    )
    log.info(
        f"[{user_id[:8]}] ChromaDB collection {cname!r} ready "
        f"({len(chunks)} chunks, cosine distance)"
    )


# ── Background video indexing ──────────────────────────────────────────────────
async def _process_video(
    video_id: str, metadata: dict, user_id: str, db_id: str, db: asyncpg.Pool
) -> None:
    # Fix #18: _indices_lock guards _user_indexing_count write
    with _indices_lock:
        _user_indexing_count[user_id] = _user_indexing_count.get(user_id, 0) + 1

    try:
        segments = await fetch_transcript(video_id)
        chunks   = chunk_transcript(segments, metadata, settings.chunk_size, settings.chunk_overlap)
        log.info(f"[{user_id[:8]}] {len(chunks)} chunks for video {video_id}")

        # Fix #1: wrap blocking ChromaDB indexing in thread pool
        # Fix #2: no save_local() — ChromaDB auto-persists
        await asyncio.to_thread(_index_to_chroma, chunks, user_id, video_id)

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
        # Fix #18: _indices_lock guards _user_indexing_count decrement
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
    password: str = Field(..., min_length=8)
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
    query:    str           = Field(..., min_length=1, max_length=2000)   # Fix #16
    mode:     str           = Field("chain", pattern="^(chain|agent)$")
    video_id: Optional[str] = Field(None, pattern=r'^[a-zA-Z0-9_-]{11}$')  # Fix #23
    history:  List[dict]    = []


class VideoSource(BaseModel):
    video_id:      str
    title:         str
    channel:       str             = ""
    thumbnail:     str             = ""
    timestamp:     str
    start_seconds: float           = 0
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
    # Warm up ChromaDB client — creates ./chroma_db/ directory if needed
    get_chroma_client()
    _key = settings.groq_api_key
    log.info(f"Groq API key loaded ({len(_key)} chars, prefix={_key[:7]}…)")
    log.info("Zeno v4.0 started — ChromaDB RAG pipeline")
    yield
    if _db_pool:
        await _db_pool.close()
    log.info("Zeno server stopped")


app = FastAPI(title="Zeno RAG API", version="4.0.0", lifespan=lifespan)

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
    # No pre-warming task needed — ChromaDB queries are on-demand with no load overhead
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
    """Fix #5: optional video_id for per-video polling."""
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

    # Fix #23: validate format before any operation (path traversal prevention)
    if not re.fullmatch(r'[a-zA-Z0-9_-]{11}', video_id):
        raise HTTPException(400, "Invalid video ID format")

    async with db.acquire() as conn:
        deleted = await conn.fetchval(
            "DELETE FROM videos WHERE user_id=$1::uuid AND video_id=$2 RETURNING id",
            user_id, video_id,
        )
    if not deleted:
        raise HTTPException(404, "Video not found")

    # Evict all cached answers for this video
    prefix = f"{user_id}:{video_id}:"
    with _cache_lock:
        stale = [k for k in _query_cache if k.startswith(prefix)]
        for k in stale:
            _query_cache.pop(k, None)

    # Delete ChromaDB collection — replaces shutil.rmtree(faiss_path)
    cname = _collection_name(user_id, video_id)
    try:
        await asyncio.to_thread(get_chroma_client().delete_collection, cname)
        log.info(f"[{user_id[:8]}] Deleted ChromaDB collection {cname!r}")
    except Exception as e:
        # Collection may not exist if indexing failed mid-way — non-fatal
        log.warning(f"[{user_id[:8]}] Could not delete collection {cname!r}: {e}")

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

    # Fix #17: verify ownership before any vector search
    title, channel = await _get_owned_video(user_id, req.video_id, db)

    # Fix #1: wrap blocking ChromaDB search in thread pool
    context, sources = await asyncio.to_thread(
        retrieve_for_video, user_id, req.video_id, req.query
    )

    # Fix #4: return early if no context — never call LLM with empty context
    if not context:
        return ChatResponse(
            answer=f"⚠️ I couldn't find relevant content for your question in this video's transcript.",
            sources=[],
            model=settings.model_name,
        )

    prompt_text = build_agent_prompt(req.query, context, title, channel, req.history)
    result      = await get_llm().ainvoke(prompt_text)
    answer      = result.content

    # Fix #7: insert video_id into query_history
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

    if not _check_chat_rate(user_id):
        raise HTTPException(429, "Rate limit exceeded — max 10 queries per minute")

    # Fix #17: verify ownership before any vector search
    title, channel = await _get_owned_video(user_id, req.video_id, db)

    # Cache hit: serve without hitting LLM
    ckey   = _cache_key(user_id, req.video_id, req.query)
    cached = _cache_get(ckey)
    if cached:
        log.info(f"[{user_id[:8]}] Cache hit for query on {req.video_id}")
        async def _from_cache():
            yield _sse({'type': 'sources', 'sources': cached['sources']})
            yield _sse({'type': 'token',   'content': cached['answer']})
            yield _sse({'type': 'done',    'model':   settings.model_name, 'cached': True})
        return StreamingResponse(
            _from_cache(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Fix #1: retrieve BEFORE entering the streaming generator
    context, sources = await asyncio.to_thread(
        retrieve_for_video, user_id, req.video_id, req.query
    )
    prompt_text = build_agent_prompt(req.query, context, title, channel, req.history)

    async def generate():
        yield _sse({'type': 'sources', 'sources': sources})

        # Fix #4: early exit if no context — no LLM call
        if not context:
            yield _sse({'type': 'token', 'content': "⚠️ I couldn't find relevant content for your question in this video's transcript."})
            yield _sse({'type': 'done', 'model': settings.model_name})
            return

        llm  = get_llm(streaming=True)
        full: list[str] = []

        try:
            async for chunk in llm.astream(prompt_text):
                if chunk.content:
                    full.append(chunk.content)
                    yield _sse({'type': 'token', 'content': chunk.content})

            full_answer = "".join(full)
            yield _sse({'type': 'done', 'model': settings.model_name})

            _cache_put(ckey, {'answer': full_answer, 'sources': sources})

            # Fix #7: insert video_id into query_history
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
    limit: int = Query(default=50, ge=1, le=200),   # Fix #19
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


# ── Health check ───────────────────────────────────────────────────────────────
@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"status": "ok", "model": settings.model_name, "version": "4.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
