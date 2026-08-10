import httpx
from youtube_transcript_api import YouTubeTranscriptApi
from app.core.config import settings

async def fetch_transcript(video_id: str):
    # 1. Try YouTubeTranscriptApi with Auto-Generated Captions support
    try:
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        try:
            # Try manual English transcript first
            transcript = transcript_list.find_transcript(['en', 'en-US', 'en-GB', 'en-IN'])
        except Exception:
            # Fallback to YouTube Auto-Generated English transcript
            transcript = transcript_list.find_generated_transcript(['en', 'en-US', 'en-GB', 'en-IN'])
        
        segments = transcript.fetch()
        return [
            {
                "text": s["text"],
                "start": s["start"],
                "duration": s.get("duration", 0)
            }
            for s in segments
        ]
    except Exception as primary_error:
        print(f"[Transcript Primary Fail] {primary_error}")

    # 2. Fallback: Supadata API (Bypasses YouTube Cloud IP Bans)
    supa_key = getattr(settings, "supadata_api_key", "") or "sd_03ac033a66e89560755c7ee5de34190c"
    if supa_key:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    "https://api.supadata.ai/v1/youtube/transcript",
                    params={"videoId": video_id, "lang": "en"},
                    headers={"x-api-key": supa_key},
                    timeout=15.0
                )
                if resp.status_code == 200:
                    data = resp.json()
                    content = data.get("content", [])
                    if content:
                        return [
                            {
                                "text": item.get("text", ""),
                                "start": float(item.get("start", 0)) / 1000.0 if float(item.get("start", 0)) > 1000 else float(item.get("start", 0)),
                                "duration": float(item.get("duration", 0)) / 1000.0 if float(item.get("duration", 0)) > 1000 else float(item.get("duration", 0))
                            }
                            for item in content
                        ]
        except Exception as supa_err:
            print(f"[Supadata Fail] {supa_err}")

    # 3. Direct simple YouTubeTranscriptApi fallback
    try:
        segments = YouTubeTranscriptApi.get_transcript(video_id)
        return [
            {
                "text": s["text"],
                "start": s["start"],
                "duration": s.get("duration", 0)
            }
            for s in segments
        ]
    except Exception:
        pass

    raise RuntimeError("Could not fetch transcript for this video. Please try another video or check if English captions are available.")