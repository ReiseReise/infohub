"""任务路由 — 上传/列表/详情/删除/重处理/导出"""

import re
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.audio_task import AudioTask, TaskStatus
from app.models.prompt_template import PromptTemplate
from app.models.usage_log import UsageLog, ServiceType
from app.schemas.task import TaskCreateRequest, TaskResponse, TaskListResponse
from app.api.deps import get_current_user
from app.services.storage_service import get_storage
from app.tasks.audio_pipeline import start_audio_pipeline, resolve_url_and_start_pipeline

router = APIRouter(prefix="/tasks", tags=["任务"])

ALLOWED_FORMATS = {"mp3", "m4a", "wav", "flac", "ogg", "mp4", "webm", "aac", "wma"}
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB


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


def _extract_summary_text(task: AudioTask) -> str:
    if isinstance(task.summary_result, dict):
        text = task.summary_result.get("text")
        if isinstance(text, str):
            return text.strip()
    return ""


def _compute_task_integrity(task: AudioTask) -> tuple[str, str | None]:
    transcript_ready = len(_normalize_text(task.transcript_text)) >= 80
    summary_ready = len(_normalize_text(_extract_summary_text(task))) >= 20

    if task.status != TaskStatus.done:
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
    effective_status = TaskStatus.failed if integrity_status == "repair_needed" else task.status
    return TaskResponse(
        id=str(task.id),
        title=task.title,
        status=effective_status,
        error_message=task.error_message,
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
        failure_code=failure_code,
        failure_detail=failure_detail,
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
        .where(PromptTemplate.is_active == True)
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
    return {
        "llm_models": [
            {"id": "__default_doubao_endpoint__", "name": "豆包 Endpoint（跟随默认配置）", "description": "实际 endpoint 请在设置里配置 DEFAULT_LLM_ENDPOINT_ID=ep-...", "price": "按豆包 endpoint 计费"},
            {"id": "dashscope/qwen-flash", "name": "Qwen Flash", "description": "作为回退模型保留", "price": "~0.01 元/小时音频"},
            {"id": "dashscope/qwen-max", "name": "Qwen Max", "description": "高质量总结", "price": "~0.09 元/小时音频"},
        ],
        "asr_models": [
            {"id": "auto", "name": "自动选择", "description": "根据配置自动选择最优 ASR"},
            {"id": "tingwu", "name": "通义听悟", "description": "阿里听悟 ASR，适合高质量会议/播客转写"},
            {"id": "paraformer", "name": "Paraformer", "description": "0.288 元/小时，性价比高"},
        ],
    }


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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AudioTask).where(AudioTask.id == uuid.UUID(task_id), AudioTask.user_id == current_user.id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "任务不存在")

    if prompt_template_id:
        task.prompt_template_id = uuid.UUID(prompt_template_id)
    if llm_model:
        task.llm_model = llm_model
    task.status = TaskStatus.uploading
    task.summary_result = None
    task.multimodal_result = None
    await db.commit()

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
