from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    groq_api_key     : str
    pinecone_api_key : str
    jwt_secret_key   : str
    database_url     : str

    chunk_size       : int = 512
    chunk_overlap    : int = 64
    top_k            : int = 5
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24

    pinecone_index_name: str = "zeno"
    pinecone_cloud: str = "aws"
    pinecone_region: str = "us-east-1"
    embedding_dimension: int = 384
    model_name: str = "llama-3.1-8b-instant"
    allowed_origins: str = "http://localhost:5173"

settings = Settings()