import threading
from typing import Optional
from langchain_huggingface import HuggingFaceEmbeddings
from app.core.config import settings

_embeddings: Optional[HuggingFaceEmbeddings] = None
_lock = threading.Lock()


def get_embeddings() -> HuggingFaceEmbeddings:
    global _embeddings
    if _embeddings is None:
        with _lock:
            if _embeddings is None:
                _embeddings = HuggingFaceEmbeddings(
                    model_name=settings.embedding_model,
                    model_kwargs={"device": "cpu"},
                    encode_kwargs={"normalize_embeddings": True},
                )
    return _embeddings