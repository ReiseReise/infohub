"""管理端 — 看板统计 + 费用明细"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import select, func, extract, case, cast, Float
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.audio_task import AudioTask, TaskStatus
from app.models.usage_log import UsageLog, ServiceType
from app.api.deps import get_admin_user

router = APIRouter(prefix="/admin/dashboard", tags=["管理-看板"])


@router.get("/stats")
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Total tasks
    total_tasks = (await db.execute(select(func.count()).select_from(AudioTask))).scalar() or 0

    # Today's new tasks
    today_tasks = (await db.execute(
        select(func.count()).select_from(AudioTask).where(AudioTask.created_at >= today_start)
    )).scalar() or 0

    # Done tasks
    done_tasks = (await db.execute(
        select(func.count()).select_from(AudioTask).where(AudioTask.status == TaskStatus.done.value)
    )).scalar() or 0

    # Total users
    total_users = (await db.execute(select(func.count()).select_from(User))).scalar() or 0

    # Total cost
    total_cost = (await db.execute(
        select(func.coalesce(func.sum(UsageLog.estimated_cost), 0))
    )).scalar() or 0

    # This month cost
    month_cost = (await db.execute(
        select(func.coalesce(func.sum(UsageLog.estimated_cost), 0))
        .where(UsageLog.created_at >= month_start)
    )).scalar() or 0

    # Total ASR seconds
    total_asr_seconds = (await db.execute(
        select(func.coalesce(func.sum(UsageLog.audio_seconds), 0))
        .where(UsageLog.service_type == ServiceType.asr.value)
    )).scalar() or 0

    return {
        "total_tasks": total_tasks,
        "today_tasks": today_tasks,
        "done_tasks": done_tasks,
        "total_users": total_users,
        "total_cost": round(float(total_cost), 4),
        "month_cost": round(float(month_cost), 4),
        "total_asr_seconds": total_asr_seconds,
    }


@router.get("/cost-by-service")
async def get_cost_by_service(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(
        select(
            UsageLog.service_type,
            func.count().label("count"),
            func.coalesce(func.sum(UsageLog.estimated_cost), 0).label("total_cost"),
            func.coalesce(func.sum(UsageLog.audio_seconds), 0).label("total_seconds"),
            func.coalesce(func.sum(UsageLog.input_tokens), 0).label("total_input_tokens"),
            func.coalesce(func.sum(UsageLog.output_tokens), 0).label("total_output_tokens"),
        )
        .group_by(UsageLog.service_type)
        .order_by(func.sum(UsageLog.estimated_cost).desc())
    )
    rows = result.all()
    return [
        {
            "service_type": r.service_type,
            "count": r.count,
            "total_cost": round(float(r.total_cost), 4),
            "total_seconds": r.total_seconds,
            "total_input_tokens": r.total_input_tokens,
            "total_output_tokens": r.total_output_tokens,
        }
        for r in rows
    ]


@router.get("/cost-by-user")
async def get_cost_by_user(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(
        select(
            User.username,
            User.email,
            func.count(func.distinct(UsageLog.task_id)).label("task_count"),
            func.coalesce(func.sum(UsageLog.estimated_cost), 0).label("total_cost"),
            func.coalesce(func.sum(UsageLog.audio_seconds), 0).label("total_seconds"),
        )
        .join(UsageLog, UsageLog.user_id == User.id)
        .group_by(User.id, User.username, User.email)
        .order_by(func.sum(UsageLog.estimated_cost).desc())
    )
    rows = result.all()
    return [
        {
            "username": r.username,
            "email": r.email,
            "task_count": r.task_count,
            "total_cost": round(float(r.total_cost), 4),
            "total_seconds": r.total_seconds,
        }
        for r in rows
    ]


@router.get("/recent-usage")
async def get_recent_usage(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(
        select(
            UsageLog.service_type,
            UsageLog.model_name,
            UsageLog.estimated_cost,
            UsageLog.audio_seconds,
            UsageLog.input_tokens,
            UsageLog.output_tokens,
            UsageLog.created_at,
            User.username,
            AudioTask.title,
        )
        .join(User, UsageLog.user_id == User.id)
        .join(AudioTask, UsageLog.task_id == AudioTask.id)
        .order_by(UsageLog.created_at.desc())
        .limit(limit)
    )
    rows = result.all()
    return [
        {
            "service_type": r.service_type,
            "model_name": r.model_name,
            "estimated_cost": round(float(r.estimated_cost or 0), 4),
            "audio_seconds": r.audio_seconds,
            "input_tokens": r.input_tokens,
            "output_tokens": r.output_tokens,
            "created_at": r.created_at.isoformat() if r.created_at else "",
            "username": r.username,
            "task_title": r.title,
        }
        for r in rows
    ]
