"""听见智慧 — FastAPI 入口"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db, async_session
from app.services.auth_service import create_initial_admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    async with async_session() as db:
        await create_initial_admin(db)
        await _seed_prompt_templates(db)
        await _seed_model_configs(db)
    yield
    # Shutdown


app = FastAPI(
    title=settings.app_name,
    description="将非结构化音频转化为结构化知识卡片",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === 注册路由 ===
from app.api.tasks_from_url import router as from_url_router
from app.api.auth import router as auth_router
from app.api.tasks import router as tasks_router
from app.api.admin.models import router as admin_models_router
from app.api.admin.prompts import router as admin_prompts_router
from app.api.admin.users import router as admin_users_router
from app.api.admin.dashboard import router as admin_dashboard_router
from app.api.admin.tasks import router as admin_tasks_router
from app.api.admin.usage import router as admin_usage_router
from app.api.internal_llm import router as internal_llm_router
from app.api.internal_probe import router as internal_probe_router
from app.api.internal_storage import router as internal_storage_router
from app.api.internal_usage import router as internal_usage_router
from app.websocket.task_progress import router as ws_router

app.include_router(from_url_router, prefix="/api/v1", tags=["tasks-url"])
app.include_router(auth_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(admin_models_router, prefix="/api")
app.include_router(admin_prompts_router, prefix="/api")
app.include_router(admin_users_router, prefix="/api")
app.include_router(admin_dashboard_router, prefix="/api")
app.include_router(admin_tasks_router, prefix="/api")
app.include_router(admin_usage_router, prefix="/api")
app.include_router(internal_llm_router, prefix="/api")
app.include_router(internal_probe_router, prefix="/api")
app.include_router(internal_storage_router, prefix="/api")
app.include_router(internal_usage_router, prefix="/api")
app.include_router(ws_router, prefix="/api")


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "app": settings.app_name, "env": settings.app_env}


async def _seed_prompt_templates(db):
    """首次启动时插入预设 Prompt 模板"""
    from sqlalchemy import select, func
    from app.models.prompt_template import PromptTemplate
    from app.services.prompt_service import PRESET_TEMPLATES

    count = await db.execute(select(func.count()).select_from(PromptTemplate))
    if count.scalar() > 0:
        return  # 已有模板

    for tpl_data in PRESET_TEMPLATES:
        tpl = PromptTemplate(
            name=tpl_data["name"],
            description=tpl_data["description"],
            category=tpl_data["category"],
            template_text=tpl_data["template_text"],
            variables=tpl_data["variables"],
            is_system=True,
            version=1,
        )
        db.add(tpl)

    await db.commit()


async def _seed_model_configs(db):
    """确保系统默认模型与当前 env 凭证保持同步。"""
    from sqlalchemy import select
    from app.models.model_config import ModelConfig, ModelType, TestStatus
    from app.services.crypto_service import encrypt_api_key

    def _clean(value: str | None) -> str:
        return (value or "").strip()

    def _is_endpoint_id(value: str) -> bool:
        return value.startswith("ep-")

    preferred_doubao_endpoint = next((
        candidate for candidate in [
            _clean(os.getenv("DEFAULT_LLM_ENDPOINT_ID")),
            _clean(settings.default_llm_endpoint_id),
            _clean(os.getenv("DOUBAO_ENDPOINT_ID")),
            _clean(settings.doubao_endpoint_id),
        ]
        if _is_endpoint_id(candidate)
    ), "")
    alias_only_endpoint = (
        not _clean(os.getenv("DEFAULT_LLM_ENDPOINT_ID"))
        and not _clean(settings.default_llm_endpoint_id)
        and (
            _is_endpoint_id(_clean(os.getenv("DOUBAO_ENDPOINT_ID")))
            or _is_endpoint_id(_clean(settings.doubao_endpoint_id))
        )
    )
    legacy_doubao_value = next((
        candidate for candidate in [
            _clean(os.getenv("DEFAULT_LLM_MODEL")),
            _clean(os.getenv("ARK_MODEL")),
            _clean(settings.ark_model),
        ]
        if candidate
    ), "")
    invalid_ark_target = bool(legacy_doubao_value) and "doubao" in legacy_doubao_value.lower() and not preferred_doubao_endpoint
    default_llm_target = preferred_doubao_endpoint if (preferred_doubao_endpoint and settings.ark_api_key) else ""
    if not default_llm_target and settings.dashscope_api_key:
        default_llm_target = "dashscope/qwen-flash"

    async def ensure_model(
        provider: str,
        model_name: str,
        model_type: str,
        *,
        alias: str | None = None,
        api_key: str = "",
        base_url: str | None = None,
        extra_config: dict | None = None,
        is_default: bool = False,
        is_active: bool = True,
        force_sync_existing: bool = False,
    ):
        result = await db.execute(select(ModelConfig).where(
            ModelConfig.provider == provider,
            ModelConfig.model_name == model_name,
            ModelConfig.model_type == model_type,
        ))
        model = result.scalar_one_or_none()
        encrypted = encrypt_api_key(api_key) if api_key else None

        if model:
            if alias and not model.alias:
                model.alias = alias
            if encrypted and (force_sync_existing or not model.api_key_encrypted):
                model.api_key_encrypted = encrypted
            if base_url is not None and (force_sync_existing or not model.base_url):
                model.base_url = base_url
            if extra_config:
                model.extra_config = {**(model.extra_config or {}), **extra_config}
            if api_key and (force_sync_existing or not model.is_active):
                model.is_active = is_active
            if force_sync_existing:
                model.test_status = TestStatus.untested
                model.test_message = "Synced from env at startup"
            return

        existing_default = await db.execute(select(ModelConfig).where(
            ModelConfig.model_type == model_type,
            ModelConfig.is_default == True,
        ).limit(1))
        has_default = existing_default.scalar_one_or_none() is not None

        db.add(ModelConfig(
            provider=provider,
            alias=alias,
            model_name=model_name,
            model_type=model_type,
            api_key_encrypted=encrypted,
            base_url=base_url,
            extra_config=extra_config,
            is_default=is_default and not has_default,
            is_active=is_active if api_key else False if provider == "volcengine_ark" else is_active,
        ))

    if settings.dashscope_api_key:
        await ensure_model(
            provider="dashscope",
            model_name="paraformer-v2",
            model_type=ModelType.asr.value,
            alias="通义听悟-语音转写",
            api_key=settings.dashscope_api_key,
            base_url="https://dashscope.aliyuncs.com",
            extra_config={"mode": "auto"},
            is_default=True,
            is_active=True,
            force_sync_existing=True,
        )
        await ensure_model(
            provider="dashscope",
            model_name="dashscope/qwen-flash",
            model_type=ModelType.llm.value,
            alias="Qwen Flash 备用",
            api_key=settings.dashscope_api_key,
            base_url=None,
            extra_config={"role": "fallback"},
            is_default=False,
            is_active=True,
            force_sync_existing=True,
        )

    if preferred_doubao_endpoint:
        await ensure_model(
            provider="volcengine_ark",
            model_name=preferred_doubao_endpoint,
            model_type=ModelType.llm.value,
            alias="豆包-默认主模型",
            api_key=settings.ark_api_key,
            base_url=settings.ark_base_url,
            extra_config={"role": "default", "accessMode": "endpoint", "endpointId": preferred_doubao_endpoint},
            is_default=True,
            is_active=bool(settings.ark_api_key),
            force_sync_existing=True,
        )

    llm_defaults = await db.execute(select(ModelConfig).where(ModelConfig.model_type == ModelType.llm.value))
    for model in llm_defaults.scalars().all():
        endpoint_id = str((model.extra_config or {}).get("endpointId") or model.model_name or "").strip()
        if model.provider == "volcengine_ark":
            if not _is_endpoint_id(endpoint_id):
                model.is_active = False
                model.test_status = TestStatus.failed
                model.test_message = "豆包配置必须填写 endpoint id（ep-...），不再支持 doubao-pro-* 作为默认模型名"
            elif not model.api_key_encrypted:
                model.is_active = False
                model.test_status = TestStatus.failed
                model.test_message = "缺少 ARK_API_KEY，当前豆包 endpoint 未启用"
        elif _is_endpoint_id(str(model.model_name or "").strip()):
            model.is_active = False
            model.test_status = TestStatus.failed
            model.test_message = "endpoint id 只能绑定到 Volcengine Ark provider，不能绑定到 DashScope 或其他 provider"
        model.is_default = (
            (model.provider == "volcengine_ark" and endpoint_id == default_llm_target)
            or (
                model.provider == "dashscope"
                and not _is_endpoint_id(default_llm_target)
                and model.model_name == default_llm_target
            )
        )

    asr_defaults = await db.execute(select(ModelConfig).where(ModelConfig.model_type == ModelType.asr.value))
    for model in asr_defaults.scalars().all():
        model.is_default = model.model_name == "paraformer-v2"

    if invalid_ark_target:
        invalid_models = await db.execute(select(ModelConfig).where(ModelConfig.provider == "volcengine_ark"))
        for model in invalid_models.scalars().all():
            model.is_active = False
            model.test_status = TestStatus.failed
            model.test_message = "检测到旧豆包占位值，请改用 DEFAULT_LLM_ENDPOINT_ID=ep-...；DOUBAO_ENDPOINT_ID 仅保留兼容。"
    elif alias_only_endpoint:
        ark_models = await db.execute(select(ModelConfig).where(ModelConfig.provider == "volcengine_ark"))
        for model in ark_models.scalars().all():
            if model.test_status != TestStatus.failed:
                model.test_status = TestStatus.untested
                model.test_message = "当前通过兼容字段 DOUBAO_ENDPOINT_ID 读取 endpoint，建议迁移到 DEFAULT_LLM_ENDPOINT_ID。"

    await db.commit()
