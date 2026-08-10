from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import init_db, close_db
from app.api import chat, auth, videos

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db(settings.database_url)
    yield
    await close_db()

app = FastAPI(
    title="Zeno RAG API",
    version="5.0.0",
    lifespan=lifespan
)

origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "https://zeno-youtube-summarizer-rag-nanthees30s-projects.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth")
app.include_router(videos.router)
app.include_router(chat.router)