"""内部接口 — 给 hub-engine 提供音频预算快照"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_internal_api_key
from app.database import get_db
from app.models.usage_log import ServiceType, UsageLog

router = APIRouter(prefix="/internal/usage", tags=["内部-音频预算"])


@router.get("/summary", dependencies=[Depends(require_internal_api_key)])
async def get_internal_usage_summary(
    user_id: str = Query(..., alias="user_id"),
    db: AsyncSession = Depends(get_db),
):
    try:
        user_uuid = uuid.UUID(str(user_id))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="user_id 格式无效") from exc

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total_row = (await db.execute(
        select(
            func.count(UsageLog.id),
            func.coalesce(func.sum(UsageLog.audio_seconds), 0),
            func.coalesce(func.sum(UsageLog.estimated_cost), 0),
        )
        .where(
            UsageLog.user_id == user_uuid,
            UsageLog.created_at >= month_start,
        )
    )).one()

    asr_cost = (await db.execute(
        select(func.coalesce(func.sum(UsageLog.estimated_cost), 0))
        .where(
            UsageLog.user_id == user_uuid,
            UsageLog.created_at >= month_start,
            UsageLog.service_type == ServiceType.asr.value,
        )
    )).scalar() or 0

    llm_cost = (await db.execute(
        select(func.coalesce(func.sum(UsageLog.estimated_cost), 0))
        .where(
            UsageLog.user_id == user_uuid,
            UsageLog.created_at >= month_start,
            UsageLog.service_type != ServiceType.asr.value,
        )
    )).scalar() or 0

    return {
        "data": {
            "userId": str(user_uuid),
            "monthStart": month_start.isoformat(),
            "monthEnd": now.isoformat(),
            "totalCalls": int(total_row[0] or 0),
            "audioSeconds": int(total_row[1] or 0),
            "estimatedCostMonth": round(float(total_row[2] or 0), 4),
            "asrEstimatedCostMonth": round(float(asr_cost or 0), 4),
            "llmEstimatedCostMonth": round(float(llm_cost or 0), 4),
        }
    }
