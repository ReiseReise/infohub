"""内部接口 — 给 hub-engine 提供音频轻量探测。"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import require_internal_api_key
from app.services.podcast_service import probe_audio_from_url

router = APIRouter(prefix="/internal/probe", tags=["internal-probe"])


class InternalProbeRequest(BaseModel):
    audio_url: str = Field(..., min_length=1)
    source_type: str | None = None


@router.post("")
async def probe_audio(
    req: InternalProbeRequest,
    _: None = Depends(require_internal_api_key),
):
    result = await probe_audio_from_url(req.audio_url)
    return {
        "data": {
            "sourceUrl": result.source_url,
            "sourceKind": result.source_kind,
            "probeStatus": result.probe_status,
            "resolveStrategy": result.resolve_strategy,
            "resolvedAudioUrl": result.resolved_audio_url,
            "title": result.title,
            "duration": result.duration,
            "contentLength": result.content_length,
            "mimeType": result.mime_type,
            "reason": result.reason,
        }
    }
