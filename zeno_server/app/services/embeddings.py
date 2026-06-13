import threading
from langchain_community.embeddings import FastEmbedEmbeddings
import tiktoken

_embeddings = None
_lock = threading.Lock()

def get_embeddings():
    global _embeddings
    if _embeddings is None:
        with _lock:
            if _embeddings is None:
                _embeddings = FastEmbedEmbeddings(
                    model_name="BAAI/bge-small-en-v1.5"
                )
    return _embeddings

_tokenizer = None
_tokenizer_lock = threading.Lock()

def get_tokenizer():
    global _tokenizer
    if _tokenizer is None:
        with _tokenizer_lock:
            if _tokenizer is None:
                _tokenizer = tiktoken.get_encoding("cl100k_base")
    return _tokenizer