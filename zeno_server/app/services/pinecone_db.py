import threading
from typing import Optional
from pinecone import Pinecone, ServerlessSpec
from app.core.config import settings

_pinecone_index = None
_lock = threading.Lock()

def get_namespace(user_id: str, video_id: str) -> str:
    return f"u{user_id[:8]}_v{video_id[:8]}"

def get_pinecone_index():
    global _pinecone_index
    if _pinecone_index is None:
        with _lock:
            if _pinecone_index is None:
                client = Pinecone(api_key=settings.pinecone_api_key)
                existing = [i.name for i in client.list_indexes()]
                if settings.pinecone_index_name not in existing:
                    client.create_index(
                        name=settings.pinecone_index_name,
                        dimension=settings.embedding_dimension,
                        metric="cosine",
                        spec=ServerlessSpec(
                            cloud=settings.pinecone_cloud,
                            region=settings.pinecone_region,
                        ),
                    )
                _pinecone_index = client.Index(settings.pinecone_index_name)
    return _pinecone_index

from app.services.embeddings import get_embeddings
from langchain_core.documents import Document
from typing import List

def upsert_chunks(
    chunks: List[Document],
    user_id: str,
    video_id: str
) -> None:
    ns = get_namespace(user_id, video_id)
    index = get_pinecone_index()
    emb = get_embeddings()

    # Step 1: embed
    texts = [c.page_content for c in chunks]
    vectors_data = emb.embed_documents(texts)

    # Step 2: build vectors
    vectors = []
    for i, (chunk, vector) in enumerate(zip(chunks, vectors_data)):
        vectors.append({
            "id": f"{video_id}_{i}",
            "values": vector,
            "metadata": {
                **chunk.metadata,
                "text": chunk.page_content,
            }
        })

    # Step 3: batch upsert
    BATCH = 100
    for i in range(0, len(vectors), BATCH):
        index.upsert(
            vectors=vectors[i:i + BATCH],
            namespace=ns
        )
    

from langchain_core.documents import Document
from typing import Tuple, List

def query_namespace(
    user_id: str,
    video_id: str,
    query: str
) -> List[Tuple[Document, float]]:
    ns = get_namespace(user_id, video_id)
    emb = get_embeddings()
    index = get_pinecone_index()

    query_vector = emb.embed_query(query)
    results = index.query(
        vector=query_vector,
        top_k=settings.top_k,
        namespace=ns,
        include_metadata=True,
    )

    output = []
    for match in results.matches:
        meta = dict(match.metadata or {})
        text = meta.pop("text", "")
        doc = Document(page_content=text, metadata=meta)
        output.append((doc, round(float(match.score), 3)))

    return output