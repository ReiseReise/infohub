"""Notify the Hub of a completed transcript without copying its content or credentials."""
import os
import logging
import httpx
from app.config import settings


async def notify_transcript_ready(item_id: str) -> bool:
    if os.getenv("JEV_ENABLED") != "true" or not settings.internal_api_key:
        return False
    base = os.getenv("INTERNAL_ARTICLE_URL", "http://hub-engine:3001").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=3.0, follow_redirects=False) as client:
            response = await client.post(
                base + "/api/jev/internal/transcript",
                headers={"X-Internal-Key": settings.internal_api_key},
                json={"itemId": item_id},
            )
            return response.is_success
    except Exception:
        logging.getLogger(__name__).warning("Jev shadow unavailable; audio flow unchanged")
        return False
