"""管理端 — 任务列表/详情/重处理"""

import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_admin_user
from app.database import get_db
from app.models.audio_task import AudioTask, TaskStatus
from app.models.user import User
from app.tasks.audio_pipeline import start_audio_pipeline

router = APIRouter(prefix="/admin", tags=["管理-任务"])


def _user_brief(user: User) -> dict:
    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        "is_active": user.is_active,
    }


def _task_brief(task: AudioTask) -> dict:
    asr_cost = float(task.asr_cost or 0)
    llm_cost = float(task.llm_cost or 0)
    return {
        "id": str(task.id),
        "title": task.title,
        "status": task.status,
        "error_message": task.error_message,
        "audio_duration": task.audio_duration,
        "audio_file_size": task.audio_file_size,
        "audio_format": task.audio_format,
        "asr_cost": asr_cost,
        "llm_cost": llm_cost,
        "total_cost": round(asr_cost + llm_cost, 4),
        "created_at": task.created_at.isoformat() if task.created_at else "",
        "updated_at": task.updated_at.isoformat() if task.updated_at else "",
    }


def _task_detail(task: AudioTask, user: User) -> dict:
    base = _task_brief(task)
    base.update({
        "audio_url": task.audio_url,
        "transcript_text": task.transcript_text,
        "transcript_raw": task.transcript_raw,
        "summary_result": task.summary_result,
        "multimodal_result": task.multimodal_result,
        "prompt_template_id": str(task.prompt_template_id) if task.prompt_template_id else None,
        "user_instruction": task.user_instruction,
        "asr_model": task.asr_model,
        "llm_model": task.llm_model,
        "processing_started_at": task.processing_started_at.isoformat() if task.processing_started_at else None,
        "processing_finished_at": task.processing_finished_at.isoformat() if task.processing_finished_at else None,
        "user": _user_brief(user),
    })
    return base


@router.get("/tasks")
async def list_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str = Query(""),
    user_id: str = Query(""),
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    conditions = []
    if status:
        conditions.append(AudioTask.status == status)
    if user_id:
        try:
            conditions.append(AudioTask.user_id == uuid.UUID(user_id))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid user_id")
    if search.strip():
        kw = f"%{search.strip()}%"
        conditions.append(or_(
            AudioTask.title.ilike(kw),
            User.username.ilike(kw),
            User.email.ilike(kw),
        ))

    stmt = select(AudioTask, User).join(User, AudioTask.user_id == User.id)
    if conditions:
        stmt = stmt.where(and_(*conditions))

    total_stmt = select(func.count()).select_from(stmt.subquery())
    total = int((await db.execute(total_stmt)).scalar() or 0)

    rows = (await db.execute(
        stmt.order_by(AudioTask.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )).all()

    return {
        "items": [
            {
                **_task_brief(task),
                "user": _user_brief(user),
            }
            for task, user in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/tasks/{task_id}")
async def get_task_detail(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    row = (await db.execute(
        select(AudioTask, User)
        .join(User, AudioTask.user_id == User.id)
        .where(AudioTask.id == task_uuid)
        .limit(1)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="任务不存在")

    task, user = row
    return {"data": _task_detail(task, user)}


@router.post("/tasks/{task_id}/reprocess")
async def reprocess_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    task = (await db.execute(
        select(AudioTask).where(AudioTask.id == task_uuid).limit(1)
    )).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    task.status = TaskStatus.uploading
    task.error_message = None
    task.transcript_raw = None
    task.transcript_text = None
    task.summary_result = None
    task.multimodal_result = None
    task.processing_started_at = None
    task.processing_finished_at = None
    task.asr_cost = None
    task.llm_cost = None
    await db.commit()
    await db.refresh(task)

    start_audio_pipeline(str(task.id))
    return {"message": "任务已重新提交", "task_id": str(task.id)}
