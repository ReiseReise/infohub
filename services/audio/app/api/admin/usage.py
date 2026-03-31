"""管理端 — AI 使用日志聚合"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, and_, case, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_admin_user
from app.database import get_db
from app.models.audio_task import AudioTask
from app.models.usage_log import ServiceType, UsageLog
from app.models.user import User

router = APIRouter(prefix="/admin/usage", tags=["管理-AI使用日志"])


def _scene_key(service_type: str | None) -> str:
    if service_type == ServiceType.asr.value:
        return "audio_asr"
    if service_type == ServiceType.translation.value:
        return "audio_translation"
    if service_type == ServiceType.multimodal.value:
        return "audio_multimodal"
    return "audio_summary"


def _model_key(row) -> str:
    return row.endpoint_id or row.model_name or "unknown"


def _status_key(row) -> str:
    return "error" if row.error_message else "success"


def _resolve_time_range(time_window: str, interval: str | None, from_value: str | None, to_value: str | None):
    now = datetime.now(timezone.utc)
    if from_value:
        from_dt = datetime.fromisoformat(from_value.replace("Z", "+00:00"))
        to_dt = datetime.fromisoformat(to_value.replace("Z", "+00:00")) if to_value else now
        return from_dt, to_dt, "hour" if interval == "hour" else "day"

    from_dt = now
    if time_window == "24h":
        from_dt = now - timedelta(hours=24)
    elif time_window == "30d":
        from_dt = now - timedelta(days=30)
    else:
        from_dt = now - timedelta(days=7)
    return from_dt, now, "hour" if interval == "hour" or time_window == "24h" else "day"


def _bucket_rows(rows):
    return [
        {
            "key": row.key or "unknown",
            "count": int(row.count or 0),
            "inputTokens": int(getattr(row, "input_tokens", 0) or 0),
            "outputTokens": int(getattr(row, "output_tokens", 0) or 0),
            "estimatedCost": float(getattr(row, "estimated_cost", 0) or 0),
            "avgLatencyMs": float(getattr(row, "avg_latency_ms", 0) or 0),
        }
        for row in rows
    ]


def _hotspot_rows(rows):
    return [
        {
            "key": row.key or "unknown",
            "count": int(row.count or 0),
            "estimatedCost": float(row.estimated_cost or 0),
            "avgLatencyMs": float(row.avg_latency_ms or 0),
        }
        for row in rows
    ]


@router.get("/summary")
async def get_usage_summary(
    time_window: str = Query("7d", alias="timeWindow"),
    interval: str | None = Query(None, alias="interval"),
    from_value: str | None = Query(None, alias="from"),
    to_value: str | None = Query(None, alias="to"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    from_dt, to_dt, resolved_interval = _resolve_time_range(time_window, interval, from_value, to_value)
    filters = [UsageLog.created_at >= from_dt, UsageLog.created_at <= to_dt]
    status_expr = case((UsageLog.error_message.is_(None), "success"), else_="error")
    bucket_expr = func.to_char(func.date_trunc(resolved_interval, UsageLog.created_at), 'YYYY-MM-DD"T"HH24:00:00OF')

    total_row = (await db.execute(
        select(
            func.count(UsageLog.id),
            func.coalesce(func.sum(UsageLog.input_tokens), 0),
            func.coalesce(func.sum(UsageLog.output_tokens), 0),
            func.coalesce(func.sum(UsageLog.estimated_cost), 0),
        ).where(and_(*filters))
    )).one()

    grouped = (await db.execute(
        select(
            UsageLog.service_type,
            UsageLog.provider,
            UsageLog.model_name,
            UsageLog.endpoint_id,
            status_expr.label("status"),
            func.count(UsageLog.id).label("count"),
            func.coalesce(func.sum(UsageLog.input_tokens), 0).label("input_tokens"),
            func.coalesce(func.sum(UsageLog.output_tokens), 0).label("output_tokens"),
            func.coalesce(func.sum(UsageLog.estimated_cost), 0).label("estimated_cost"),
            func.coalesce(func.avg(UsageLog.latency_ms), 0).label("avg_latency_ms"),
        )
        .where(and_(*filters))
        .group_by(UsageLog.service_type, UsageLog.provider, UsageLog.model_name, UsageLog.endpoint_id, status_expr)
    )).all()

    trend_rows = (await db.execute(
        select(
            bucket_expr.label("bucket"),
            func.count(UsageLog.id).label("calls"),
            func.sum(case((UsageLog.error_message.is_(None), 1), else_=0)).label("success"),
            func.sum(case((UsageLog.error_message.is_not(None), 1), else_=0)).label("error"),
            func.coalesce(func.sum(UsageLog.estimated_cost), 0).label("estimated_cost"),
            func.coalesce(func.sum(UsageLog.total_tokens), 0).label("total_tokens"),
            func.coalesce(func.avg(UsageLog.latency_ms), 0).label("avg_latency_ms"),
        )
        .where(and_(*filters))
        .group_by(bucket_expr)
        .order_by(bucket_expr)
    )).all()

    error_hotspots = (await db.execute(
        select(
            func.coalesce(UsageLog.error_message, "未知错误").label("key"),
            func.count(UsageLog.id).label("count"),
            func.coalesce(func.sum(UsageLog.estimated_cost), 0).label("estimated_cost"),
            func.coalesce(func.avg(UsageLog.latency_ms), 0).label("avg_latency_ms"),
        )
        .where(and_(*filters, UsageLog.error_message.is_not(None)))
        .group_by(func.coalesce(UsageLog.error_message, "未知错误"))
        .order_by(func.count(UsageLog.id).desc())
        .limit(6)
    )).all()

    expensive_hotspots = (await db.execute(
        select(
            func.coalesce(UsageLog.endpoint_id, UsageLog.model_name, UsageLog.service_type).label("key"),
            func.count(UsageLog.id).label("count"),
            func.coalesce(func.sum(UsageLog.estimated_cost), 0).label("estimated_cost"),
            func.coalesce(func.avg(UsageLog.latency_ms), 0).label("avg_latency_ms"),
        )
        .where(and_(*filters))
        .group_by(func.coalesce(UsageLog.endpoint_id, UsageLog.model_name, UsageLog.service_type))
        .order_by(func.coalesce(func.sum(UsageLog.estimated_cost), 0).desc(), func.count(UsageLog.id).desc())
        .limit(6)
    )).all()

    slow_hotspots = (await db.execute(
        select(
            UsageLog.service_type.label("key"),
            func.count(UsageLog.id).label("count"),
            func.coalesce(func.sum(UsageLog.estimated_cost), 0).label("estimated_cost"),
            func.coalesce(func.avg(UsageLog.latency_ms), 0).label("avg_latency_ms"),
        )
        .where(and_(*filters))
        .group_by(UsageLog.service_type)
        .order_by(func.coalesce(func.avg(UsageLog.latency_ms), 0).desc(), func.count(UsageLog.id).desc())
        .limit(6)
    )).all()

    def _fold_by(key_fn):
        buckets: dict[str, dict] = {}
        for row in grouped:
            key = key_fn(row)
            bucket = buckets.setdefault(key, {
                "key": key,
                "count": 0,
                "inputTokens": 0,
                "outputTokens": 0,
                "estimatedCost": 0.0,
                "avgLatencyMs": 0.0,
            })
            bucket["count"] += int(row.count or 0)
            bucket["inputTokens"] += int(row.input_tokens or 0)
            bucket["outputTokens"] += int(row.output_tokens or 0)
            bucket["estimatedCost"] += float(row.estimated_cost or 0)
            bucket["avgLatencyMs"] = max(float(row.avg_latency_ms or 0), bucket["avgLatencyMs"])
        return sorted(buckets.values(), key=lambda item: (item["estimatedCost"], item["count"]), reverse=True)

    return {
        "data": {
            "totalCalls": int(total_row[0] or 0),
            "totalInputTokens": int(total_row[1] or 0),
            "totalOutputTokens": int(total_row[2] or 0),
            "totalEstimatedCost": float(total_row[3] or 0),
            "byScene": _fold_by(lambda row: _scene_key(row.service_type)),
            "byProvider": _fold_by(lambda row: row.provider or "unknown"),
            "byModel": _fold_by(_model_key),
            "byStatus": _fold_by(lambda row: row.status or "unknown"),
            "trends": [
                {
                    "bucket": row.bucket,
                    "calls": int(row.calls or 0),
                    "success": int(row.success or 0),
                    "error": int(row.error or 0),
                    "estimatedCost": float(row.estimated_cost or 0),
                    "totalTokens": int(row.total_tokens or 0),
                    "avgLatencyMs": float(row.avg_latency_ms or 0),
                }
                for row in trend_rows
            ],
            "hotspots": {
                "errors": _hotspot_rows(error_hotspots),
                "expensive": _hotspot_rows(expensive_hotspots),
                "slow": _hotspot_rows(slow_hotspots),
            },
        },
        "source": "audio",
    }


@router.get("/events")
async def get_usage_events(
    limit: int = 50,
    status: str = Query("", alias="status"),
    scene_type: str = Query("", alias="sceneType"),
    provider: str = Query("", alias="provider"),
    search: str = Query("", alias="search"),
    from_value: str | None = Query(None, alias="from"),
    to_value: str | None = Query(None, alias="to"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    stmt = (
        select(
            UsageLog.id,
            UsageLog.user_id,
            User.username,
            User.email,
            UsageLog.service_type,
            UsageLog.provider,
            UsageLog.model_name,
            UsageLog.endpoint_id,
            UsageLog.input_tokens,
            UsageLog.output_tokens,
            UsageLog.total_tokens,
            UsageLog.estimated_cost,
            UsageLog.latency_ms,
            UsageLog.provider_request_id,
            UsageLog.api_kind,
            UsageLog.prompt_preview,
            UsageLog.response_preview,
            UsageLog.error_message,
            UsageLog.created_at,
            UsageLog.task_id,
            AudioTask.title,
        )
        .join(User, UsageLog.user_id == User.id)
        .join(AudioTask, UsageLog.task_id == AudioTask.id)
    )

    if status == "success":
        stmt = stmt.where(UsageLog.error_message.is_(None))
    elif status == "error":
        stmt = stmt.where(UsageLog.error_message.is_not(None))

    normalized_scene = (scene_type or "").strip()
    if normalized_scene == "audio_asr":
        stmt = stmt.where(UsageLog.service_type == ServiceType.asr.value)
    elif normalized_scene == "audio_translation":
        stmt = stmt.where(UsageLog.service_type == ServiceType.translation.value)
    elif normalized_scene == "audio_multimodal":
        stmt = stmt.where(UsageLog.service_type == ServiceType.multimodal.value)
    elif normalized_scene == "audio_summary":
        stmt = stmt.where(UsageLog.service_type == ServiceType.llm.value)

    if provider:
        stmt = stmt.where(UsageLog.provider == provider)

    if from_value:
        from_dt = datetime.fromisoformat(from_value.replace("Z", "+00:00"))
        stmt = stmt.where(UsageLog.created_at >= from_dt)
    if to_value:
        to_dt = datetime.fromisoformat(to_value.replace("Z", "+00:00"))
        stmt = stmt.where(UsageLog.created_at <= to_dt)

    normalized_search = (search or "").strip()
    if normalized_search:
        pattern = f"%{normalized_search}%"
        stmt = stmt.where(or_(
            cast(UsageLog.provider, String).ilike(pattern),
            cast(UsageLog.model_name, String).ilike(pattern),
            cast(UsageLog.endpoint_id, String).ilike(pattern),
            cast(UsageLog.provider_request_id, String).ilike(pattern),
            cast(UsageLog.error_message, String).ilike(pattern),
            cast(AudioTask.title, String).ilike(pattern),
            cast(User.username, String).ilike(pattern),
            cast(User.email, String).ilike(pattern),
        ))

    result = await db.execute(
        stmt.order_by(UsageLog.created_at.desc()).limit(min(limit, 200))
    )
    rows = result.all()
    return {
        "data": [
            {
                "id": str(row.id),
                "userId": str(row.user_id),
                "username": row.username,
                "email": row.email,
                "sceneType": _scene_key(row.service_type),
                "status": "error" if row.error_message else "success",
                "provider": row.provider,
                "modelName": row.model_name,
                "endpointId": row.endpoint_id,
                "targetType": "audio_task",
                "targetId": str(row.task_id),
                "label": row.title,
                "inputTokens": row.input_tokens,
                "outputTokens": row.output_tokens,
                "totalTokens": row.total_tokens,
                "estimatedCost": float(row.estimated_cost or 0),
                "latencyMs": row.latency_ms,
                "providerRequestId": row.provider_request_id,
                "apiKind": row.api_kind,
                "promptPreview": row.prompt_preview,
                "responsePreview": row.response_preview,
                "errorMessage": row.error_message,
                "createdAt": row.created_at.isoformat() if row.created_at else "",
            }
            for row in rows
        ],
        "source": "audio",
    }
