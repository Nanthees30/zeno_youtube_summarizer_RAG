import threading
from typing import Optional
from langchain_groq import ChatGroq
from app.core.config import settings

_llm: Optional[ChatGroq] = None
_llm_streaming: Optional[ChatGroq] = None
_lock = threading.Lock()

def get_llm(streaming: bool = False) -> ChatGroq:
    global _llm, _llm_streaming
    
    if streaming:
        if _llm_streaming is None:
            with _lock:
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
            with _lock:
                if _llm is None:
                    _llm = ChatGroq(
                        api_key=settings.groq_api_key,
                        model=settings.model_name,
                        temperature=0,
                        streaming=False,
                    )
        return _llm