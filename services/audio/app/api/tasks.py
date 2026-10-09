"""任务路由 — 上传/列表/详情/删除/重处理/导出"""

import re
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, status
from fastapi.responses import Response
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.models.audio_task import AudioTask, TaskStatus
from app.models.prompt_template import PromptTemplate
from app.models.usage_log import UsageLog, ServiceType
from app.schemas.task import TaskCreateRequest, TaskResponse, TaskListResponse, TaskAudioUrlResponse
from app.api.deps import get_current_user
from app.services.storage_service import OSSStorage, get_storage
from app.services.audio_config_guard import (
    AUDIO_PROMPT_CATEGORIES,
    DEFAULT_ENDPOINT_SENTINEL,
    is_audio_prompt_category,
    require_audio_llm_selection,
    resolve_audio_llm_selection,
)
from app.services.audio_artifacts import build_audio_artifacts_v1, preserve_audio_qa_answers
from app.services.audio_reprocess import (
    metadata_only_summary,
    resolve_effective_task_status,
    resolve_reprocess_stage,
)
from app.services.audio_qa import (
    build_audio_qa_answer,
    build_audio_qa_prompt,
    select_audio_qa_evidence,
    upsert_audio_qa_answer,
)
from app.services.llm_service import LLMService
from app.tasks.audio_pipeline import start_audio_pipeline, start_audio_summary_pipeline, resolve_url_and_start_pipeline

router = APIRouter(prefix="/tasks", tags=["任务"])

ALLOWED_FORMATS = {"mp3", "m4a", "wav", "flac", "ogg", "mp4", "webm", "aac", "wma"}
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB
AUDIO_PLAYBACK_EXPIRES_SECONDS = 7200


def _is_http_url(value: str | None) -> bool:
    return bool(value and value.startswith(("http://", "https://")))


def _looks_like_oss_key(value: str | None) -> bool:
    normalized = (value or "").strip()
    return normalized.startswith("audio-insight/")


def _has_oss_config() -> bool:
    return bool(settings.oss_access_key_id and settings.oss_access_key_secret and settings.oss_bucket_name)


def _storage_for_audio_url(audio_url: str):
    if settings.storage_backend == "oss":
        return get_storage()
    if _looks_like_oss_key(audio_url) and _has_oss_config():
        return OSSStorage()
    return get_storage()


def _audio_media_type(task: AudioTask) -> str:
    ext = (task.audio_format or "").lower()
    return {
        "mp3": "audio/mpeg",
        "m4a": "audio/mp4",
        "mp4": "audio/mp4",
        "wav": "audio/wav",
        "flac": "audio/flac",
        "ogg": "audio/ogg",
        "webm": "audio/webm",
        "aac": "audio/aac",
        "wma": "audio/x-ms-wma",
    }.get(ext, "application/octet-stream")


def _create_audio_playback_token(task: AudioTask) -> str:
    expire = datetime.now(timezone.utc) + timedelta(seconds=AUDIO_PLAYBACK_EXPIRES_SECONDS)
    payload = {
        "sub": str(task.user_id),
        "task_id": str(task.id),
        "scope": "audio_playback",
        "exp": expire,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def _decode_audio_playback_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
    if payload.get("scope") != "audio_playback":
        return None
    return payload


def _extract_source_meta(task: AudioTask) -> dict:
    # 优先从 transcript_raw 读取（转写完成后会写入）
    if isinstance(task.transcript_raw, dict):
        source_meta = task.transcript_raw.get("_source_meta")
        if isinstance(source_meta, dict):
            return source_meta
    # 兜底从 summary_result 读取（任务初始化/处理中）
    if isinstance(task.summary_result, dict):
        source_meta = task.summary_result.get("_source_meta")
        if isinstance(source_meta, dict):
            return source_meta
    return {}


def _extract_failure_meta(error_message: str | None) -> tuple[str | None, str | None]:
    if not error_message:
        return None, None
    match = re.match(r"^\[(?P<code>[A-Z_]+)\]\s*(?P<detail>.+)$", error_message.strip())
    if match:
        return match.group("code"), match.group("detail")
    return None, error_message


def _normalize_text(value: str | None) -> str:
    return " ".join((value or "").split()).strip()


def _default_llm_endpoint_id() -> str:
    for candidate in (settings.default_llm_endpoint_id, settings.doubao_endpoint_id):
        normalized = (candidate or "").strip()
        if normalized.startswith("ep-"):
            return normalized
    return ""


def _assert_audio_llm_ready(requested_model: str | None):
    try:
        return require_audio_llm_selection(
            requested_model,
            default_endpoint_id=_default_llm_endpoint_id(),
            has_ark_key=bool(settings.ark_api_key),
            has_dashscope_key=bool(settings.dashscope_api_key),
        )
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


async def _assert_audio_template(db: AsyncSession, template_id: str | None) -> PromptTemplate | None:
    normalized = (template_id or "").strip()
    if not normalized:
        return None
    try:
        parsed_id = uuid.UUID(normalized)
    except ValueError as error:
        raise HTTPException(400, "音频纪要模板 ID 无效") from error

    result = await db.execute(
        select(PromptTemplate).where(
            PromptTemplate.id == parsed_id,
            PromptTemplate.is_active == True,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(400, "所选音频纪要模板不存在或已停用")
    if not is_audio_prompt_category(template.category):
        raise HTTPException(400, "所选模板不属于音频工作坊，请改用会议、学习、日记或多模态模板")
    return template


def _extract_summary_text(task: AudioTask) -> str:
    if isinstance(task.summary_result, dict):
        text = task.summary_result.get("text")
        if isinstance(text, str):
            return text.strip()
    return ""


def _compute_task_integrity(task: AudioTask) -> tuple[str, str | None]:
    transcript_ready = len(_normalize_text(task.transcript_text)) >= 80
    summary_ready = len(_normalize_text(_extract_summary_text(task))) >= 20

    effective_status = resolve_effective_task_status(
        task.status,
        transcript_text=task.transcript_text,
        transcript_raw=task.transcript_raw,
        summary_result=task.summary_result,
    )
    if effective_status != TaskStatus.done.value:
        return "pending", None

    if not transcript_ready:
        return "repair_needed", "历史任务缺少有效逐字稿，建议重跑"
    if not summary_ready:
        return "repair_needed", "历史任务缺少有效摘要，建议重跑"

    return "ok", None


def _build_export_markdown(task: AudioTask) -> str:
    md = f"# {task.title}\n\n"
    if task.audio_duration:
        md += f"> 时长: {task.audio_duration // 60}分{task.audio_duration % 60}秒\n"
    if task.created_at:
        md += f"> 处理时间: {task.created_at.strftime('%Y-%m-%d %H:%M')}\n"
    if task.audio_duration or task.created_at:
        md += "\n"

    summary_text = _extract_summary_text(task)
    if summary_text:
        md += summary_text
        md += "\n\n---\n\n"

    if task.transcript_text:
        md += "## 逐字稿\n\n"
        md += task.transcript_text

    return md.strip()


def _task_to_response(task: AudioTask) -> TaskResponse:
    source_meta = _extract_source_meta(task)
    failure_code, failure_detail = _extract_failure_meta(task.error_message)
    transcript_ready = len(_normalize_text(task.transcript_text)) >= 80
    summary_ready = len(_normalize_text(_extract_summary_text(task))) >= 20
    integrity_status, integrity_reason = _compute_task_integrity(task)
    recovered_status = resolve_effective_task_status(
        task.status,
        transcript_text=task.transcript_text,
        transcript_raw=task.transcript_raw,
        summary_result=task.summary_result,
    )
    effective_status = TaskStatus.failed if integrity_status == "repair_needed" else TaskStatus(recovered_status)
    recovered_from_retry_failure = task.status == TaskStatus.failed and effective_status == TaskStatus.done
    return TaskResponse(
        id=str(task.id),
        title=task.title,
        status=effective_status,
        error_message=None if recovered_from_retry_failure else task.error_message,
        audio_url=task.audio_url,
        audio_format=task.audio_format,
        audio_duration=task.audio_duration,
        audio_file_size=task.audio_file_size,
        transcript_text=task.transcript_text,
        transcript_raw=task.transcript_raw,
        summary_result=task.summary_result,
        multimodal_result=task.multimodal_result,
        prompt_template_id=str(task.prompt_template_id) if task.prompt_template_id else None,
        user_instruction=task.user_instruction,
        asr_model=task.asr_model,
        llm_model=task.llm_model,
        asr_cost=task.asr_cost,
        llm_cost=task.llm_cost,
        tags=task.tags,
        processing_started_at=task.processing_started_at.isoformat() if task.processing_started_at else None,
        processing_finished_at=task.processing_finished_at.isoformat() if task.processing_finished_at else None,
        created_at=task.created_at.isoformat() if task.created_at else "",
        updated_at=task.updated_at.isoformat() if task.updated_at else "",
        source_kind=(str(source_meta.get("source_kind")) if source_meta.get("source_kind") else None),
        source_url=(str(source_meta.get("source_url")) if source_meta.get("source_url") else None),
        download_stage=(str(source_meta.get("download_stage")) if source_meta.get("download_stage") else None),
        download_strategy=(
            str(source_meta.get("download_strategy") or source_meta.get("resolve_strategy"))
            if (source_meta.get("download_strategy") or source_meta.get("resolve_strategy"))
            else None
        ),
        storage_backend=(str(source_meta.get("storage_backend")) if source_meta.get("storage_backend") else None),
        requested_asr_model=(str(source_meta.get("requested_asr_model")) if source_meta.get("requested_asr_model") else None),
        effective_asr_model=(str(source_meta.get("effective_asr_model")) if source_meta.get("effective_asr_model") else None),
        asr_mode=(str(source_meta.get("asr_mode")) if source_meta.get("asr_mode") else None),
        asr_selection_reason=(str(source_meta.get("asr_selection_reason")) if source_meta.get("asr_selection_reason") else None),
        fallback_provider=(str(source_meta.get("fallback_provider")) if source_meta.get("fallback_provider") else None),
        fallback_reason=(str(source_meta.get("fallback_reason")) if source_meta.get("fallback_reason") else None),
        failure_code=None if recovered_from_retry_failure else failure_code,
        failure_detail=None if recovered_from_retry_failure else failure_detail,
        asr_status="ready" if transcript_ready else ("failed" if effective_status == TaskStatus.failed else "pending"),
        summary_status="ready" if summary_ready else ("failed" if effective_status == TaskStatus.failed else "pending"),
        render_status="ready" if summary_ready or transcript_ready else ("failed" if effective_status == TaskStatus.failed else "pending"),
        task_integrity_status=integrity_status,
        task_integrity_reason=integrity_reason,
        export_markdown=_build_export_markdown(task),
    )


@router.post("/upload", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def upload_audio(
    file: UploadFile = File(...),
    title: str = Form(""),
    prompt_template_id: str = Form(""),
    user_instruction: str = Form(""),
    llm_model: str = Form(""),
    asr_model: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 配额检查（admin 不受限）
    if current_user.role.value != "admin":
        month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        used_result = await db.execute(
            select(func.coalesce(func.sum(UsageLog.audio_seconds), 0))
            .where(
                UsageLog.user_id == current_user.id,
                UsageLog.service_type == ServiceType.asr.value,
                UsageLog.created_at >= month_start,
            )
        )
        used_seconds = used_result.scalar() or 0
        if used_seconds >= current_user.quota_seconds_monthly:
            raise HTTPException(
                403,
                f"本月配额已用完（已用 {used_seconds // 60} 分钟 / 配额 {current_user.quota_seconds_monthly // 60} 分钟）。请联系管理员提升配额。",
            )

    await _assert_audio_template(db, prompt_template_id)
    _assert_audio_llm_ready(llm_model)

    # 校验文件格式
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename else ""
    if ext not in ALLOWED_FORMATS:
        raise HTTPException(400, f"不支持的格式: {ext}。支持: {', '.join(ALLOWED_FORMATS)}")

    # 读取文件
    file_data = await file.read()
    if len(file_data) > MAX_FILE_SIZE:
        raise HTTPException(400, f"文件过大，最大 500MB")

    # 上传到存储
    storage = get_storage()
    audio_url = await storage.upload(file_data, file.filename or f"audio.{ext}", file.content_type or "")

    # 创建任务记录
    task = AudioTask(
        user_id=current_user.id,
        title=title or (file.filename or "未命名音频"),
        status=TaskStatus.uploading,
        audio_url=audio_url,
        audio_format=ext,
        audio_file_size=len(file_data),
        prompt_template_id=uuid.UUID(prompt_template_id) if prompt_template_id else None,
        user_instruction=user_instruction or None,
        llm_model=llm_model or None,
        asr_model=asr_model or None,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    # 启动处理管道
    start_audio_pipeline(str(task.id))

    return _task_to_response(task)


class FromUrlRequest(BaseModel):
    url: str
    title: str = ""
    prompt_template_id: str = ""
    user_instruction: str = ""
    llm_model: str = ""


@router.post("/from-url", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_from_url(
    req: FromUrlRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 配额检查（admin 不受限）
    if current_user.role.value != "admin":
        month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        used_result = await db.execute(
            select(func.coalesce(func.sum(UsageLog.audio_seconds), 0))
            .where(
                UsageLog.user_id == current_user.id,
                UsageLog.service_type == ServiceType.asr.value,
                UsageLog.created_at >= month_start,
            )
        )
        used_seconds = used_result.scalar() or 0
        if used_seconds >= current_user.quota_seconds_monthly:
            raise HTTPException(403, "本月配额已用完，请联系管理员提升配额。")

    url = (req.url or "").strip()
    if not url:
        raise HTTPException(400, "链接不能为空")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, "仅支持 http/https 链接")

    await _assert_audio_template(db, req.prompt_template_id)
    _assert_audio_llm_ready(req.llm_model)

    title = (req.title or "").strip() or "链接抓取中"

    # 创建任务
    source_meta = {"source_url": url, "download_stage": "queued"}
    task = AudioTask(
        user_id=current_user.id,
        title=title,
        status=TaskStatus.uploading,
        audio_url=None,
        audio_format=None,
        audio_file_size=None,
        audio_duration=None,
        prompt_template_id=uuid.UUID(req.prompt_template_id) if req.prompt_template_id else None,
        user_instruction=req.user_instruction or None,
        llm_model=req.llm_model or None,
        summary_result={"_source_meta": source_meta},
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    resolve_url_and_start_pipeline.delay(str(task.id), url, req.title or None)
    return _task_to_response(task)


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: str = Query("", alias="status"),
    tag: str = Query(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(AudioTask).where(AudioTask.user_id == current_user.id)

    if status_filter:
        query = query.where(AudioTask.status == status_filter)
    if tag:
        query = query.where(AudioTask.tags.any(tag))

    # 总数
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # 分页
    query = query.order_by(desc(AudioTask.created_at)).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    tasks = result.scalars().all()

    return TaskListResponse(
        items=[_task_to_response(t) for t in tasks],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/quota")
async def get_my_quota(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    used_result = await db.execute(
        select(func.coalesce(func.sum(UsageLog.audio_seconds), 0))
        .where(
            UsageLog.user_id == current_user.id,
            UsageLog.service_type == ServiceType.asr.value,
            UsageLog.created_at >= month_start,
        )
    )
    used_seconds = int(used_result.scalar() or 0)
    quota = current_user.quota_seconds_monthly
    return {
        "quota_seconds": quota,
        "used_seconds": used_seconds,
        "remaining_seconds": max(0, quota - used_seconds),
        "quota_minutes": quota // 60,
        "used_minutes": used_seconds // 60,
        "remaining_minutes": max(0, (quota - used_seconds)) // 60,
        "is_admin": current_user.role.value == "admin",
    }


@router.get("/config/templates")
async def list_templates_for_user(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(PromptTemplate)
        .where(
            PromptTemplate.is_active == True,
            PromptTemplate.category.in_(tuple(AUDIO_PROMPT_CATEGORIES)),
        )
        .order_by(PromptTemplate.is_system.desc(), PromptTemplate.created_at)
    )
    templates = result.scalars().all()
    return [
        {
            "id": str(t.id),
            "name": t.name,
            "description": t.description,
            "category": t.category,
        }
        for t in templates
    ]


@router.get("/config/models")
async def list_models_for_user(
    current_user: User = Depends(get_current_user),
):
    endpoint = _default_llm_endpoint_id()
    llm_options = [
        {
            "id": DEFAULT_ENDPOINT_SENTINEL,
            "name": "豆包 Endpoint（跟随默认配置）",
            "description": "使用系统已绑定供应商的默认 Endpoint",
            "price": "按豆包 Endpoint 计费",
            "provider": "volcengine_ark",
        },
        {"id": "dashscope/qwen-flash", "name": "Qwen Flash", "description": "作为回退模型保留", "price": "~0.01 元/小时音频", "provider": "dashscope"},
        {"id": "dashscope/qwen-max", "name": "Qwen Max", "description": "高质量总结", "price": "~0.09 元/小时音频", "provider": "dashscope"},
    ]
    for option in llm_options:
        selection = resolve_audio_llm_selection(
            option["id"],
            default_endpoint_id=endpoint,
            has_ark_key=bool(settings.ark_api_key),
            has_dashscope_key=bool(settings.dashscope_api_key),
        )
        option["available"] = selection.available
        option["unavailable_reason"] = selection.reason
    return {
        "llm_models": llm_options,
        "asr_models": [
            {"id": "auto", "name": "自动选择", "description": "根据配置自动选择最优 ASR"},
            {"id": "tingwu", "name": "通义听悟", "description": "阿里听悟 ASR，适合高质量会议/播客转写"},
            {"id": "paraformer", "name": "Paraformer", "description": "0.288 元/小时，性价比高"},
        ],
    }


@router.get("/{task_id}/audio-url", response_model=TaskAudioUrlResponse)
async def get_task_audio_url(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AudioTask).where(AudioTask.id == uuid.UUID(task_id), AudioTask.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "任务不存在")
    if not task.audio_url:
        raise HTTPException(404, "当前任务还没有可播放的音频文件")

    audio_url = task.audio_url.strip()
    if _is_http_url(audio_url):
        return TaskAudioUrlResponse(
            url=audio_url,
            expires_in=AUDIO_PLAYBACK_EXPIRES_SECONDS,
            mode="direct",
        )

    try:
        signed_url = await _storage_for_audio_url(audio_url).get_url(audio_url, expires=AUDIO_PLAYBACK_EXPIRES_SECONDS)
    except Exception:
        signed_url = ""

    if _is_http_url(signed_url):
        return TaskAudioUrlResponse(
            url=signed_url,
            expires_in=AUDIO_PLAYBACK_EXPIRES_SECONDS,
            mode="signed",
        )

    token = _create_audio_playback_token(task)
    return TaskAudioUrlResponse(
        url=f"/api/audio/tasks/{task_id}/audio-stream?token={token}",
        expires_in=AUDIO_PLAYBACK_EXPIRES_SECONDS,
        mode="stream",
    )


@router.get("/{task_id}/audio-stream")
async def stream_task_audio(
    task_id: str,
    token: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    payload = _decode_audio_playback_token(token)
    if not payload or str(payload.get("task_id")) != task_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="播放地址已失效，请重新打开任务")

    try:
        task_uuid = uuid.UUID(task_id)
        user_uuid = uuid.UUID(str(payload.get("sub")))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="播放地址无效")

    result = await db.execute(
        select(AudioTask).where(AudioTask.id == task_uuid, AudioTask.user_id == user_uuid)
    )
    task = result.scalar_one_or_none()
    if not task or not task.audio_url:
        raise HTTPException(404, "当前任务还没有可播放的音频文件")

    try:
        audio_data = await _storage_for_audio_url(task.audio_url).download(task.audio_url)
    except FileNotFoundError:
        raise HTTPException(404, "音频文件不存在，建议重新上传或重跑任务")
    except Exception as exc:
        raise HTTPException(502, f"音频文件读取失败: {exc}")

    return Response(content=audio_data, media_type=_audio_media_type(task))


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AudioTask).where(AudioTask.id == uuid.UUID(task_id), AudioTask.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "任务不存在")
    return _task_to_response(task)


@router.post("/{task_id}/artifacts/rebuild", response_model=TaskResponse)
async def rebuild_task_artifacts(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """基于已保存的逐字稿和纪要重建复盘资产，不重复调用 ASR 或 LLM。"""
    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError as error:
        raise HTTPException(400, "音频任务 ID 无效") from error

    result = await db.execute(
        select(AudioTask).where(AudioTask.id == task_uuid, AudioTask.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "任务不存在")

    summary_text = _extract_summary_text(task)
    transcript_text = (task.transcript_text or "").strip()
    if not summary_text:
        raise HTTPException(400, "当前任务没有可用纪要，无法生成复盘资产")
    if not transcript_text:
        raise HTTPException(400, "当前任务没有可用逐字稿，无法生成带依据的复盘资产")

    summary = dict(task.summary_result or {})
    previous_artifacts = summary.get("artifacts")
    summary["artifacts"] = preserve_audio_qa_answers(build_audio_artifacts_v1(
        title=task.title,
        summary_text=summary_text,
        transcript_text=transcript_text,
        transcript_raw=task.transcript_raw,
    ), previous_artifacts)
    task.summary_result = summary
    await db.commit()
    await db.refresh(task)
    return _task_to_response(task)


class AudioQaRequest(BaseModel):
    question: str = Field(..., min_length=2, max_length=500)
    prompt_key: str | None = Field(default=None, max_length=40)


class AudioQaResponse(BaseModel):
    answer: dict
    task: TaskResponse


@router.post("/{task_id}/qa", response_model=AudioQaResponse)
async def generate_task_qa(
    task_id: str,
    req: AudioQaRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """针对当前音频生成可回听的问答资产；无有效 ASR 引用时不保存回答。"""
    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError as error:
        raise HTTPException(400, "音频任务 ID 无效") from error

    result = await db.execute(
        select(AudioTask).where(AudioTask.id == task_uuid, AudioTask.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "任务不存在")

    question = _normalize_text(req.question)
    if len(question) < 2:
        raise HTTPException(400, "请输入需要核对的问题")
    if not (task.transcript_text or "").strip():
        raise HTTPException(400, "当前任务没有可用逐字稿，无法生成带时间引用的回答")

    evidence = select_audio_qa_evidence(
        task.transcript_raw,
        question,
        prompt_key=req.prompt_key,
    )
    if not evidence:
        raise HTTPException(400, "当前逐字稿缺少可用时间段，无法生成可回听回答")

    selection = _assert_audio_llm_ready(task.llm_model or "")
    summary_text = _extract_summary_text(task)
    prompt = build_audio_qa_prompt(
        title=task.title,
        question=question,
        summary_text=summary_text,
        evidence=evidence,
    )
    label = f"audio_qa:{_normalize_text(req.prompt_key) or 'custom'}"
    completion = None
    try:
        completion = await LLMService().complete(
            model=selection.model,
            prompt=prompt,
            provider=selection.provider,
            extra_config=(
                {"accessMode": "endpoint", "endpointId": selection.model}
                if selection.provider == "volcengine_ark"
                else None
            ),
            temperature=0.2,
            max_tokens=1800,
        )
        answer = build_audio_qa_answer(
            question=question,
            prompt_key=req.prompt_key,
            raw_response=completion.text,
            evidence=evidence,
            model=completion.model,
            provider=completion.provider or selection.provider,
            input_tokens=completion.input_tokens,
            output_tokens=completion.output_tokens,
        )
    except Exception as error:
        db.add(UsageLog(
            task_id=task.id,
            user_id=current_user.id,
            service_type=ServiceType.llm.value,
            provider=(completion.provider if completion else selection.provider) or "unknown",
            model_name=(completion.model if completion else selection.model) or "unknown",
            endpoint_id=completion.endpoint_id if completion else None,
            input_tokens=completion.input_tokens if completion else None,
            output_tokens=completion.output_tokens if completion else None,
            total_tokens=completion.total_tokens if completion else None,
            estimated_cost=completion.estimated_cost if completion else None,
            latency_ms=completion.latency_ms if completion else None,
            provider_request_id=completion.provider_request_id if completion else None,
            api_kind=completion.api_kind if completion else None,
            prompt_preview=prompt[:400],
            response_preview=(completion.text[:400] if completion else None),
            label=label,
            error_message=str(error)[:800],
        ))
        await db.commit()
        raise HTTPException(502, f"AI 问答生成失败：{str(error)[:180]}") from error

    summary = dict(task.summary_result or {})
    artifacts = summary.get("artifacts")
    if not isinstance(artifacts, dict) or artifacts.get("schema") != "audio_artifacts_v1":
        artifacts = build_audio_artifacts_v1(
            title=task.title,
            summary_text=summary_text,
            transcript_text=task.transcript_text or "",
            transcript_raw=task.transcript_raw,
        )
    summary["artifacts"] = upsert_audio_qa_answer(artifacts, answer)
    task.summary_result = summary
    if completion.estimated_cost is not None:
        task.llm_cost = float(task.llm_cost or 0) + float(completion.estimated_cost)
    db.add(UsageLog(
        task_id=task.id,
        user_id=current_user.id,
        service_type=ServiceType.llm.value,
        provider=completion.provider or selection.provider or "unknown",
        model_name=completion.model or selection.model,
        endpoint_id=completion.endpoint_id,
        input_tokens=completion.input_tokens,
        output_tokens=completion.output_tokens,
        total_tokens=completion.total_tokens,
        estimated_cost=completion.estimated_cost,
        latency_ms=completion.latency_ms,
        provider_request_id=completion.provider_request_id,
        api_kind=completion.api_kind,
        prompt_preview=prompt[:400],
        response_preview=completion.text[:400],
        label=label,
    ))
    await db.commit()
    await db.refresh(task)
    return AudioQaResponse(answer=answer, task=_task_to_response(task))


class TagsUpdateRequest(BaseModel):
    tags: list[str] = []


@router.patch("/{task_id}/tags", response_model=TaskResponse)
async def update_tags(
    task_id: str,
    req: TagsUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AudioTask).where(AudioTask.id == uuid.UUID(task_id), AudioTask.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "任务不存在")
    task.tags = [t.strip().lstrip("#") for t in req.tags if t.strip()]
    await db.commit()
    await db.refresh(task)
    return _task_to_response(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AudioTask).where(AudioTask.id == uuid.UUID(task_id), AudioTask.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "任务不存在")

    # 删除存储文件
    if task.audio_url:
        storage = get_storage()
        await storage.delete(task.audio_url)

    await db.delete(task)
    await db.commit()


@router.post("/{task_id}/reprocess", response_model=TaskResponse)
async def reprocess_task(
    task_id: str,
    prompt_template_id: str = "",
    llm_model: str = "",
    stage: str = "auto",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AudioTask).where(AudioTask.id == uuid.UUID(task_id), AudioTask.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "任务不存在")

    effective_template_id = prompt_template_id or (str(task.prompt_template_id) if task.prompt_template_id else "")
    stored_llm_model = (task.llm_model or "").strip()
    effective_llm_model = (llm_model or "").strip()
    if not effective_llm_model:
        effective_llm_model = (
            DEFAULT_ENDPOINT_SENTINEL
            if stored_llm_model.startswith("ep-") and stored_llm_model == _default_llm_endpoint_id()
            else stored_llm_model
        )
    await _assert_audio_template(db, effective_template_id)
    _assert_audio_llm_ready(effective_llm_model)

    try:
        reprocess_stage = resolve_reprocess_stage(
            stage,
            transcript_text=task.transcript_text,
            transcript_raw=task.transcript_raw,
        )
    except ValueError as error:
        raise HTTPException(400, str(error)) from error

    if prompt_template_id:
        task.prompt_template_id = uuid.UUID(prompt_template_id)
    if llm_model:
        task.llm_model = llm_model
    elif stored_llm_model.startswith("ep-") and effective_llm_model == DEFAULT_ENDPOINT_SENTINEL:
        task.llm_model = DEFAULT_ENDPOINT_SENTINEL

    preserved_summary = metadata_only_summary(
        task.summary_result if isinstance(task.summary_result, dict) else None,
        task.transcript_raw if isinstance(task.transcript_raw, dict) else None,
        preserve_artifacts=reprocess_stage == "summary",
    )
    source_meta = _extract_source_meta(task)
    callback_meta = (
        preserved_summary.get("_callback")
        if isinstance(preserved_summary, dict) and isinstance(preserved_summary.get("_callback"), dict)
        else {}
    )

    task.status = TaskStatus.summarizing if reprocess_stage == "summary" else TaskStatus.uploading
    task.error_message = None
    task.summary_result = preserved_summary
    task.multimodal_result = None
    task.processing_started_at = datetime.now(timezone.utc)
    task.processing_finished_at = None
    if reprocess_stage == "full":
        task.transcript_text = None
        task.transcript_raw = None
    await db.commit()

    if reprocess_stage == "summary":
        start_audio_summary_pipeline({
            "task_id": str(task.id),
            "user_id": str(task.user_id),
            "audio_url": task.audio_url,
            "duration": task.audio_duration or 0,
            "transcript_text": task.transcript_text or "",
            "transcript_raw": task.transcript_raw or {},
            "asr_cost": task.asr_cost or 0,
            "source_meta": source_meta,
            "webhook_url": callback_meta.get("webhook_url"),
            "article_id": callback_meta.get("article_id"),
        })
    else:
        start_audio_pipeline(str(task.id))
    await db.refresh(task)
    return _task_to_response(task)


@router.get("/{task_id}/export")
async def export_task_markdown(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AudioTask).where(AudioTask.id == uuid.UUID(task_id), AudioTask.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "任务不存在")

    return {"markdown": _build_export_markdown(task), "filename": f"{task.title}.md"}
