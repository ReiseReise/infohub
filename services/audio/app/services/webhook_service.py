"""Webhook callback — notifies article-service when a task completes"""
import httpx
import logging
from typing import Optional

logger = logging.getLogger(__name__)

async def send_webhook(webhook_url: str, task_id: str, status: str,
    article_id: Optional[int] = None, transcript: Optional[str] = None,
    knowledge: Optional[str] = None, cost: Optional[float] = None,
    duration: Optional[float] = None, error: Optional[str] = None,
    secret: Optional[str] = None) -> bool:
    payload = {"task_id": task_id, "status": status, "article_id": article_id,
               "transcript": transcript, "knowledge": knowledge,
               "cost": cost, "duration": duration, "error": error}
    headers = {"Content-Type": "application/json"}
    if secret:
        headers["X-Webhook-Secret"] = secret
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(webhook_url, json=payload, headers=headers)
            r.raise_for_status()
            return True
    except Exception as e:
        logger.error(f"Webhook failed for task {task_id}: {e}")
        return False
