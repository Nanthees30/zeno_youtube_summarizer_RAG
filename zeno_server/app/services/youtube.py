import re
import httpx
from fastapi import HTTPException

def extract_video_id(url: str):
    match = re.search(
        r'(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([a-zA-Z0-9_-]{11})',
        url,
    )
    return match.group(1) if match else None

async def fetch_video_metadata(video_id: str) -> dict:
    url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url)
    if resp.status_code != 200:
        raise HTTPException(400, "Could not fetch video info")
    data = resp.json()
    return {
        "video_id": video_id,
        "title": data.get("title", "Unknown"),
        "channel": data.get("author_name", "Unknown"),
        "thumbnail": f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg",
    }