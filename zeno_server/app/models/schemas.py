from pydantic import BaseModel, Field
from typing import Optional, List

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str = Field(..., min_length=8)
    name: Optional[str] = None

class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    mode: str = Field("chain", pattern="^(chain|agent)$")
    video_id: Optional[str] = Field(None, pattern=r'^[a-zA-Z0-9_-]{11}$')
    history: List[dict] = []

class VideoSource(BaseModel):
    video_id: str
    title: str
    channel: str = ""
    thumbnail: str = ""
    timestamp: str
    start_seconds: float = 0
    content: str
    score: Optional[float] = None

class ChatResponse(BaseModel):
    answer: str
    sources: List[VideoSource]
    model: str

class IndexVideoRequest(BaseModel):
    url: str