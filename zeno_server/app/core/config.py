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
    webshare_proxy_username: str = ""
    webshare_proxy_password: str = ""

    pinecone_index_name: str = "zeno"
    pinecone_cloud: str = "aws"
    pinecone_region: str = "us-east-1"
    embedding_dimension: int = 384
    # Updated to active Groq model
    model_name: str = "llama-3.3-70b-versatile"
    allowed_origins: str = "http://localhost:5173"
    supadata_api_key: str = "sd_03ac033a66e89560755c7ee5de34190c"

settings = Settings()