"""内部 LLM 代理接口 — 供 hub-engine 复用模型中心配置。"""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_internal_api_key
from app.database import get_db
from app.models.model_config import ModelConfig
from app.services.crypto_service import decrypt_api_key
from app.services.llm_service import LLMService

router = APIRouter(prefix="/internal/llm", tags=["internal-llm"])


class InternalCompleteRequest(BaseModel):
    model_config_id: str
    prompt: str = Field(..., min_length=1)
    temperature: float = 0.3
    max_tokens: int = 1024


@router.post("/complete")
async def complete_with_model_config(
    req: InternalCompleteRequest,
    _: None = Depends(require_internal_api_key),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ModelConfig).where(ModelConfig.id == uuid.UUID(req.model_config_id)))
    model = result.scalar_one_or_none()
    if not model or not model.is_active:
        raise HTTPException(status_code=404, detail="模型配置不存在或未启用")

    api_key = decrypt_api_key(model.api_key_encrypted) if model.api_key_encrypted else ""
    service = LLMService()
    completion = await service.complete(
        model=model.model_name,
        prompt=req.prompt,
        api_key=api_key,
        base_url=model.base_url,
        provider=model.provider,
        extra_config=model.extra_config,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
    )
    return {
        "text": completion.text,
        "model": completion.model,
        "provider": completion.provider or model.provider,
        "endpointId": completion.endpoint_id,
        "inputTokens": completion.input_tokens,
        "outputTokens": completion.output_tokens,
        "totalTokens": completion.total_tokens,
        "estimatedCost": completion.estimated_cost,
        "providerRequestId": completion.provider_request_id,
        "latencyMs": completion.latency_ms,
        "apiKind": completion.api_kind,
    }
