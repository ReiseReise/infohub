"""POST /api/v1/tasks/from-url — accept audio URL (for podcast RSS auto-transcribe)"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..api.deps import require_internal_api_key
from ..database import get_db
from ..models.audio_task import AudioTask, TaskStatus
from ..models.user import User, UserRole
from ..services.auth_service import _build_shadow_identity
from ..tasks.audio_pipeline import resolve_url_and_start_pipeline

router = APIRouter()


class FromUrlRequest(BaseModel):
    audio_url: str
    title: str
    article_id: Optional[str] = None
    user_id: Optional[str] = None      # UUID string from article-service (already JWT-verified)
    webhook_url: Optional[str] = None
    prompt_template_id: Optional[uuid.UUID] = None


def _normalize_title(title: str) -> str:
    safe = "".join(ch for ch in title if ch.isalnum() or ch in ("-", "_", " ", ".")).strip()
    if not safe:
        safe = "链接抓取中"
    return safe[:80].rstrip(". ")


async def _ensure_shadow_user(db: AsyncSession, user_uuid: uuid.UUID) -> None:
    result = await db.execute(select(User.id).where(User.id == user_uuid))
    if result.scalar_one_or_none():
        return

    username, email = _build_shadow_identity(str(user_uuid))
    user = User(
        id=user_uuid,
        username=username,
        email=email,
        password_hash="external_auth",
        role=UserRole.user,
        is_active=True,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()


@router.post("/tasks/from-url")
async def create_task_from_url(
    request: FromUrlRequest,
    _: None = Depends(require_internal_api_key),
    db: AsyncSession = Depends(get_db),
):
    """
    Create an audio processing task from a direct URL.
    Called internally by hub-engine podcast cron — user_id is JWT-verified upstream and guarded by X-Internal-API-Key.
    """
    if not request.user_id:
        raise HTTPException(status_code=400, detail="user_id required")

    # Parse and validate UUID format
    try:
        user_uuid = uuid.UUID(request.user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id format")

    audio_url = (request.audio_url or "").strip()
    if not audio_url:
        raise HTTPException(status_code=400, detail="audio_url required")
    if not (audio_url.startswith("http://") or audio_url.startswith("https://")):
        raise HTTPException(status_code=400, detail="only http/https url is supported")

    title = _normalize_title(request.title or "链接抓取中")

    # 内部 from-url 调用没有 JWT，因此需要在 audio-service 本地补齐用户映射，
    # 否则 audio_tasks.user_id 外键会直接失败。
    await _ensure_shadow_user(db, user_uuid)

    # Create task record (task created immediately; download/transcribe run in background)
    source_meta = {"source_url": audio_url, "download_stage": "queued"}
    summary = {"_source_meta": source_meta}
    if request.webhook_url or request.article_id:
        summary["_callback"] = {
            "webhook_url": request.webhook_url,
            "article_id": request.article_id,
        }

    task = AudioTask(
        user_id=user_uuid,
        title=title,
        status=TaskStatus.uploading,
        prompt_template_id=request.prompt_template_id,
        summary_result=summary,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    # Resolve URL and continue processing in background
    resolve_url_and_start_pipeline.delay(str(task.id), audio_url, request.title or None)

    return {
        "job_id": str(task.id),
        "status": "queued",
        "message": "Task created and queued",
    }
