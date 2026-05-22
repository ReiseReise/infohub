"""管理端 — 模型配置 CRUD"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.model_config import ModelConfig, TestStatus
from app.schemas.admin import ModelConfigCreate, ModelConfigUpdate, ModelConfigResponse
from app.api.deps import get_admin_user
from app.services.crypto_service import encrypt_api_key, decrypt_api_key

router = APIRouter(prefix="/admin/models", tags=["管理-模型配置"])


def _is_ark_endpoint(provider: str | None, model_name: str | None) -> bool:
    return (provider or "").strip().lower() == "volcengine_ark" and str(model_name or "").strip().startswith("ep-")


def _assert_valid_model_target(provider: str | None, model_name: str | None):
    if (provider or "").strip().lower() == "volcengine_ark" and not _is_ark_endpoint(provider, model_name):
        raise HTTPException(400, "Volcengine Ark 必须填写 endpoint id（ep-...），不再支持 doubao-pro-* 作为默认模型名")


@router.get("", response_model=list[ModelConfigResponse])
async def list_models(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(select(ModelConfig).order_by(ModelConfig.model_type, ModelConfig.created_at))
    models = result.scalars().all()
    return [_model_to_response(m) for m in models]


@router.post("", response_model=ModelConfigResponse, status_code=status.HTTP_201_CREATED)
async def create_model(
    req: ModelConfigCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    _assert_valid_model_target(req.provider, req.model_name)
    # 如果设为默认，先取消同类型其他默认
    if req.is_default:
        await _clear_default(db, req.model_type)

    model = ModelConfig(
        provider=req.provider,
        alias=req.alias,
        model_name=req.model_name,
        model_type=req.model_type,
        api_key_encrypted=encrypt_api_key(req.api_key) if req.api_key else None,
        base_url=req.base_url,
        extra_config=req.extra_config,
        is_default=req.is_default,
    )
    db.add(model)
    await db.commit()
    await db.refresh(model)
    return _model_to_response(model)


@router.put("/{model_id}", response_model=ModelConfigResponse)
async def update_model(
    model_id: str,
    req: ModelConfigUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(select(ModelConfig).where(ModelConfig.id == uuid.UUID(model_id)))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "模型配置不存在")

    next_provider = req.provider if req.provider is not None else model.provider
    next_model_name = req.model_name if req.model_name is not None else model.model_name
    _assert_valid_model_target(next_provider, next_model_name)

    if req.provider is not None:
        model.provider = req.provider
    if req.alias is not None:
        model.alias = req.alias
    if req.model_name is not None:
        model.model_name = req.model_name
    if req.api_key is not None:
        model.api_key_encrypted = encrypt_api_key(req.api_key) if req.api_key else None
    if req.base_url is not None:
        model.base_url = req.base_url
    if req.extra_config is not None:
        model.extra_config = req.extra_config
    if req.is_default is not None:
        if req.is_default:
            await _clear_default(db, model.model_type)
        model.is_default = req.is_default
    if req.is_active is not None:
        model.is_active = req.is_active

    await db.commit()
    await db.refresh(model)
    return _model_to_response(model)


@router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(select(ModelConfig).where(ModelConfig.id == uuid.UUID(model_id)))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "模型配置不存在")
    await db.delete(model)
    await db.commit()


@router.post("/{model_id}/test", response_model=ModelConfigResponse)
async def test_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(select(ModelConfig).where(ModelConfig.id == uuid.UUID(model_id)))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "模型配置不存在")

    api_key = decrypt_api_key(model.api_key_encrypted) if model.api_key_encrypted else ""

    try:
        if model.model_type == "llm":
            from app.services.llm_service import LLMService
            svc = LLMService()
            result = await svc.complete(
                model=model.model_name,
                prompt="Hello, this is a connectivity test. Reply with 'OK'.",
                api_key=api_key,
                base_url=model.base_url,
                provider=model.provider,
                extra_config=model.extra_config,
                max_tokens=128,
            )
            model.test_status = TestStatus.success
            target = result.endpoint_id or result.model
            model.test_message = f"连通成功: {target} · {result.api_kind} · {result.text[:50]}"
        elif model.model_type == "asr":
            model.test_status = TestStatus.success
            model.test_message = "ASR 模型配置已保存（需上传音频测试实际转写）"
        elif model.model_type == "multimodal":
            model.test_status = TestStatus.success
            model.test_message = "多模态模型配置已保存（需实际生成测试）"
        else:
            model.test_status = TestStatus.success
            model.test_message = "配置已保存"
    except Exception as e:
        model.test_status = TestStatus.failed
        model.test_message = f"连通失败: {str(e)[:200]}"

    model.tested_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(model)
    return _model_to_response(model)


async def _clear_default(db: AsyncSession, model_type: str):
    result = await db.execute(
        select(ModelConfig).where(ModelConfig.model_type == model_type, ModelConfig.is_default == True)
    )
    for m in result.scalars().all():
        m.is_default = False


def _model_to_response(model: ModelConfig) -> ModelConfigResponse:
    return ModelConfigResponse(
        id=str(model.id),
        provider=model.provider,
        alias=model.alias,
        model_name=model.model_name,
        model_type=model.model_type,
        has_api_key=bool(model.api_key_encrypted),
        base_url=model.base_url,
        extra_config=model.extra_config,
        is_default=model.is_default,
        is_active=model.is_active,
        test_status=model.test_status,
        test_message=model.test_message,
        tested_at=model.tested_at.isoformat() if model.tested_at else None,
        created_at=model.created_at.isoformat() if model.created_at else "",
        updated_at=model.updated_at.isoformat() if model.updated_at else "",
    )
