"""音频处理管道 — 5 步 Celery Chain"""

import uuid
import asyncio
import tempfile
import logging
import os
import shutil
from datetime import datetime, timezone
from celery import chain
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.tasks.celery_app import celery_app
from app.config import settings
from app.models.audio_task import AudioTask, TaskStatus
from app.models.prompt_template import PromptTemplate
from app.models.usage_log import UsageLog, ServiceType

logger = logging.getLogger(__name__)

# Celery 任务中需要独立的 DB session（不共享 FastAPI 的）
# 每次调用创建新 engine，避免跨 event loop 复用连接池
def _make_session():
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def _run_async(coro):
    """在 Celery 同步 worker 中运行 async 函数"""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def _update_task_status(task_id: str, status: str, **extra_fields):
    """更新任务状态"""
    async with _make_session()() as db:
        result = await db.execute(select(AudioTask).where(AudioTask.id == uuid.UUID(task_id)))
        task = result.scalar_one()
        task.status = status
        for key, value in extra_fields.items():
            if hasattr(task, key):
                setattr(task, key, value)
        await db.commit()


async def _update_task_source_meta(task_id: str, **meta_fields):
    """合并写入 source meta（保留现有 callback/source 信息）。"""
    async with _make_session()() as db:
        result = await db.execute(select(AudioTask).where(AudioTask.id == uuid.UUID(task_id)))
        task = result.scalar_one_or_none()
        if not task:
            return

        # JSON 字段必须赋新对象，避免 SQLAlchemy 将“原地修改”误判为无变更。
        raw_summary = task.summary_result if isinstance(task.summary_result, dict) else {}
        summary = dict(raw_summary)
        raw_source_meta = summary.get("_source_meta")
        source_meta = dict(raw_source_meta) if isinstance(raw_source_meta, dict) else {}
        source_meta.update({k: v for k, v in meta_fields.items() if v is not None})
        summary["_source_meta"] = source_meta
        task.summary_result = summary
        await db.commit()


def _normalize_filename(title: str, ext: str) -> str:
    safe = "".join(ch for ch in title if ch.isalnum() or ch in ("-", "_", " ", ".", "（", "）", "【", "】", "·")).strip()
    if not safe:
        safe = "podcast-audio"
    safe = safe[:80].rstrip(". ")
    return f"{safe}.{ext or 'mp3'}"


async def _send_failure_webhook(task_id: str, error_message: str):
    """失败时回调上游，避免 Feed 长期停留在 processing。"""
    async with _make_session()() as db:
        result = await db.execute(select(AudioTask).where(AudioTask.id == uuid.UUID(task_id)))
        task = result.scalar_one_or_none()
        if not task:
            return

        callback_meta = {}
        source_meta = {}
        if isinstance(task.summary_result, dict):
            if isinstance(task.summary_result.get("_callback"), dict):
                callback_meta = task.summary_result.get("_callback") or {}
            if isinstance(task.summary_result.get("_source_meta"), dict):
                source_meta = task.summary_result.get("_source_meta") or {}

        webhook_url = callback_meta.get("webhook_url")
        if not webhook_url:
            return

        payload = {
            "task_id": task_id,
            "status": "failed",
            "article_id": callback_meta.get("article_id"),
            "error": error_message,
            "source_meta": source_meta,
        }

        import httpx

        headers = {"Content-Type": "application/json"}
        secret = settings.audio_webhook_secret
        if secret:
            headers["X-Webhook-Secret"] = secret

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(webhook_url, json=payload, headers=headers)
                resp.raise_for_status()
                logger.info(f"[webhook] 失败回调成功: {webhook_url}")
        except Exception as err:
            logger.error(f"[webhook] 失败回调失败 {webhook_url}: {err}")


async def _mark_task_failed(task_id: str, error: Exception | str):
    message = str(error) if isinstance(error, Exception) else str(error)
    message = message.strip()[:1800] if message else "未知错误"
    await _update_task_status(
        task_id,
        TaskStatus.failed,
        error_message=message,
        processing_finished_at=datetime.now(timezone.utc),
    )
    await _send_failure_webhook(task_id, message)


def _preview_text(value: str | None, limit: int = 400) -> str | None:
    normalized = " ".join((value or "").split())
    if not normalized:
        return None
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1].rstrip() + "…"


def _normalize_transcript_text(value: str | None) -> str:
    return " ".join((value or "").split()).strip()


def _has_valid_transcript(text: str | None, segments: list | None = None) -> bool:
    normalized = _normalize_transcript_text(text)
    if len(normalized) >= 80:
        return True
    if segments:
        return any(
            _normalize_transcript_text(getattr(segment, "text", None) if not isinstance(segment, dict) else segment.get("text"))
            for segment in segments
        )
    return False


async def _log_usage(task_id: str, user_id: str, service_type: str, provider: str, model_name: str, **kwargs):
    """记录用量"""
    async with _make_session()() as db:
        log = UsageLog(
            task_id=uuid.UUID(task_id),
            user_id=uuid.UUID(user_id),
            service_type=service_type,
            provider=provider,
            model_name=model_name,
            endpoint_id=kwargs.get("endpoint_id"),
            input_tokens=kwargs.get("input_tokens"),
            output_tokens=kwargs.get("output_tokens"),
            total_tokens=kwargs.get("total_tokens"),
            audio_seconds=kwargs.get("audio_seconds"),
            estimated_cost=kwargs.get("estimated_cost"),
            latency_ms=kwargs.get("latency_ms"),
            provider_request_id=kwargs.get("provider_request_id"),
            api_kind=kwargs.get("api_kind"),
            prompt_preview=_preview_text(kwargs.get("prompt_preview")),
            response_preview=_preview_text(kwargs.get("response_preview")),
            label=kwargs.get("label"),
            error_message=kwargs.get("error_message"),
        )
        db.add(log)
        await db.commit()


def start_audio_pipeline(task_id: str):
    """启动完整音频处理管道"""
    pipeline = chain(
        audio_preprocess.s(task_id),
        asr_transcribe.s(),
        llm_summarize.s(),
        multimodal_generate.s(),
        post_process.s(),
    )
    pipeline.apply_async()


@celery_app.task(bind=True, name="resolve_url_and_start_pipeline")
def resolve_url_and_start_pipeline(self, task_id: str, source_url: str, title_hint: str | None = None) -> dict:
    """解析链接并下载音频；成功后再启动 5 步处理管道。"""
    logger.info(f"[URL Resolve] 开始处理链接任务: {task_id}")

    async def _resolve():
        from app.services.podcast_service import download_audio_from_url, DownloadError
        from app.services.storage_service import get_storage

        await _update_task_source_meta(task_id, source_url=source_url, download_stage="resolving")

        try:
            dl = await download_audio_from_url(source_url)
        except DownloadError as err:
            await _update_task_source_meta(task_id, download_stage="failed")
            await _mark_task_failed(task_id, f"[{err.code}] {err.message}")
            return {"task_id": task_id, "status": "failed", "error": err.message}
        except Exception as err:
            await _update_task_source_meta(task_id, download_stage="failed")
            await _mark_task_failed(task_id, f"[DOWNLOAD_FAILED] {err}")
            return {"task_id": task_id, "status": "failed", "error": str(err)}

        audio_bytes: bytes | None = None
        try:
            with open(dl.file_path, "rb") as f:
                audio_bytes = f.read()
        finally:
            tmpdir = os.path.dirname(dl.file_path)
            shutil.rmtree(tmpdir, ignore_errors=True)

        if not audio_bytes:
            await _update_task_source_meta(task_id, download_stage="failed")
            await _mark_task_failed(task_id, "[DOWNLOAD_FAILED] 下载音频为空")
            return {"task_id": task_id, "status": "failed", "error": "下载音频为空"}

        await _update_task_source_meta(task_id, download_stage="downloading")
        title = (title_hint or dl.title or "未命名音频").strip() or "未命名音频"
        filename = _normalize_filename(title, dl.format or "mp3")
        storage = get_storage()
        stored_audio_url = await storage.upload(audio_bytes, filename, "")

        async with _make_session()() as db:
            result = await db.execute(select(AudioTask).where(AudioTask.id == uuid.UUID(task_id)))
            task = result.scalar_one_or_none()
            if not task:
                return {"task_id": task_id, "status": "failed", "error": "任务不存在"}

            task.title = title
            task.audio_url = stored_audio_url
            task.audio_format = dl.format or "mp3"
            task.audio_file_size = len(audio_bytes)
            task.audio_duration = int(dl.duration) if dl.duration else None

            raw_summary = task.summary_result if isinstance(task.summary_result, dict) else {}
            summary = dict(raw_summary)
            raw_source_meta = summary.get("_source_meta")
            source_meta = dict(raw_source_meta) if isinstance(raw_source_meta, dict) else {}
            source_meta.update({
                "source_url": source_url,
                "source_kind": dl.source_kind,
                "download_strategy": dl.resolve_strategy,
                "download_stage": "finished",
            })
            summary["_source_meta"] = source_meta
            task.summary_result = summary
            await db.commit()

        start_audio_pipeline(task_id)
        return {"task_id": task_id, "status": "queued"}

    try:
        return _run_async(_resolve())
    except Exception as err:
        logger.exception(f"[URL Resolve] 失败: {task_id}: {err}")
        _run_async(_mark_task_failed(task_id, err))
        return {"task_id": task_id, "status": "failed", "error": str(err)}


# ============================================================
# Step 1: 音频预处理
# ============================================================

@celery_app.task(bind=True, name="audio_preprocess")
def audio_preprocess(self, task_id: str) -> dict:
    """格式转换 + 获取音频信息"""
    logger.info(f"[Step 1] 音频预处理: {task_id}")

    async def _process():
        from app.services.storage_service import get_storage
        from app.services.audio_service import get_audio_info, convert_to_mp3

        await _update_task_status(task_id, TaskStatus.transcribing,
                                  processing_started_at=datetime.now(timezone.utc))

        async with _make_session()() as db:
            result = await db.execute(select(AudioTask).where(AudioTask.id == uuid.UUID(task_id)))
            task = result.scalar_one()
            audio_url = task.audio_url
            user_id = str(task.user_id)
            source_meta = {}
            callback_meta = {}
            if isinstance(task.summary_result, dict):
                if isinstance(task.summary_result.get("_source_meta"), dict):
                    source_meta = task.summary_result.get("_source_meta") or {}
                if isinstance(task.summary_result.get("_callback"), dict):
                    callback_meta = task.summary_result.get("_callback") or {}

        storage = get_storage()

        # 下载音频文件
        audio_data = await storage.download(audio_url)
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as f:
            f.write(audio_data)
            temp_path = f.name

        # 获取音频信息
        info = get_audio_info(temp_path)

        # 转换为 MP3（16kHz 单声道，ASR 最优）
        mp3_path = convert_to_mp3(temp_path)

        # 上传转换后的文件
        with open(mp3_path, "rb") as f:
            mp3_data = f.read()
        mp3_url = await storage.upload(mp3_data, f"{task_id}.mp3", "audio/mpeg")

        # 更新任务信息
        await _update_task_status(
            task_id, TaskStatus.transcribing,
            audio_duration=int(info.duration),
            audio_format=info.format,
            audio_file_size=info.file_size,
        )

        # 清理临时文件
        import os
        os.unlink(temp_path)
        os.unlink(mp3_path)

        return {
            "task_id": task_id,
            "user_id": user_id,
            "audio_url": mp3_url,
            "duration": info.duration,
            "source_meta": source_meta,
            "webhook_url": callback_meta.get("webhook_url"),
            "article_id": callback_meta.get("article_id"),
        }

    try:
        return _run_async(_process())
    except Exception as err:
        logger.exception(f"[Step 1] 失败: {task_id}: {err}")
        _run_async(_mark_task_failed(task_id, err))
        raise


# ============================================================
# Step 2: ASR 转写
# ============================================================

@celery_app.task(bind=True, name="asr_transcribe")
def asr_transcribe(self, prev_result: dict) -> dict:
    """调用 ASR 服务进行语音转写
    
    ⚠️ 本地文件用 Recognition 实时 API（WebSocket），必须在 asyncio 外同步调用，
    否则 WebSocket 线程与 event loop 死锁。
    """
    task_id = prev_result["task_id"]
    logger.info(f"[Step 2] ASR 转写: {task_id}")

    from app.services.asr_service import (
        ParaformerASR,
        can_use_remote_asr,
        get_asr_provider,
        has_paraformer_credentials,
        has_tingwu_credentials,
    )
    from pathlib import Path

    try:
        # 1) 读取任务配置（async，短操作）
        async def _get_asr_model():
            async with _make_session()() as db:
                result = await db.execute(select(AudioTask).where(AudioTask.id == uuid.UUID(task_id)))
                task = result.scalar_one()
                return task.asr_model or "auto"

        requested_asr_model = _run_async(_get_asr_model())

        # 2) 确定音频路径
        if settings.storage_backend == "local":
            audio_access_url = str(Path(settings.local_storage_path) / prev_result["audio_url"])
        else:
            from app.services.storage_service import get_storage
            audio_access_url = _run_async(get_storage().get_url(prev_result["audio_url"]))

        source_meta = dict(prev_result.get("source_meta") or {})
        expected_duration = float(prev_result.get("duration") or 0)
        is_local = (settings.storage_backend == "local" and Path(audio_access_url).exists())
        remote_capable = can_use_remote_asr(audio_access_url)

        effective_asr_model = requested_asr_model or "auto"
        selection_reason: str | None = None
        fallback_provider: str | None = None
        fallback_reason: str | None = None

        if effective_asr_model == "auto":
            if expected_duration > 900 and remote_capable and has_tingwu_credentials():
                effective_asr_model = "tingwu"
                selection_reason = "long_audio_auto_route"
            elif has_paraformer_credentials():
                effective_asr_model = "paraformer"
                if expected_duration > 900 and not remote_capable and has_tingwu_credentials():
                    selection_reason = "local_storage_prevents_tingwu"
            elif remote_capable and has_tingwu_credentials():
                effective_asr_model = "tingwu"
                selection_reason = "dashscope_unavailable_auto_fallback"

        if requested_asr_model == "paraformer" and expected_duration > 900 and remote_capable and has_tingwu_credentials():
            effective_asr_model = "tingwu"
            selection_reason = "long_audio_prefer_tingwu"

        if effective_asr_model == "tingwu" and not remote_capable and has_paraformer_credentials():
            effective_asr_model = "paraformer"
            selection_reason = "tingwu_requires_remote_url"

        provider = get_asr_provider(effective_asr_model)
        asr_mode = "batch_async" if effective_asr_model == "tingwu" else ("realtime_sync" if is_local else "remote_batch")

        source_meta.update({
            "requested_asr_model": requested_asr_model,
            "effective_asr_model": effective_asr_model,
            "asr_mode": asr_mode,
            "storage_backend": settings.storage_backend,
        })
        if selection_reason:
            source_meta["asr_selection_reason"] = selection_reason
        _run_async(_update_task_source_meta(
            task_id,
            requested_asr_model=requested_asr_model,
            effective_asr_model=effective_asr_model,
            asr_mode=asr_mode,
            asr_selection_reason=selection_reason,
            storage_backend=settings.storage_backend,
        ))

        if is_local and expected_duration > 900 and not has_tingwu_credentials():
            raise RuntimeError(
                "长音频当前不能走本地 Paraformer 实时转写；请切换到 OSS 存储后重试，"
                "或补齐 Tingwu ACCESS_KEY_ID/SECRET 后再启用长音频兜底。"
            )

        # 3) 调用 ASR — 本地文件同步调用（避免 WebSocket 死锁），远程 URL 走 async
        try:
            if is_local and isinstance(provider, ParaformerASR):
                logger.info(f"[Step 2] 本地文件，使用 Recognition 实时 API (sync): {effective_asr_model}")
                transcription = provider.transcribe_local_sync(
                    audio_access_url,
                    speaker_diarization=True,
                    expected_duration=expected_duration,
                )
            else:
                transcription = _run_async(provider.transcribe(
                    audio_url=audio_access_url,
                    speaker_diarization=True,
                ))
        except TimeoutError as timeout_err:
            logger.warning(f"[Step 2] Paraformer 超时，准备兜底: {task_id}: {timeout_err}")
            if isinstance(provider, ParaformerASR) and remote_capable and has_tingwu_credentials():
                fallback_provider = "tingwu"
                fallback_reason = "paraformer_timeout"
                provider = get_asr_provider("tingwu")
                effective_asr_model = "tingwu"
                asr_mode = "batch_async"
                source_meta.update({
                    "effective_asr_model": effective_asr_model,
                    "asr_mode": asr_mode,
                    "fallback_provider": fallback_provider,
                    "fallback_reason": fallback_reason,
                })
                _run_async(_update_task_source_meta(
                    task_id,
                    effective_asr_model=effective_asr_model,
                    asr_mode=asr_mode,
                    fallback_provider=fallback_provider,
                    fallback_reason=fallback_reason,
                ))
                transcription = _run_async(provider.transcribe(
                    audio_url=audio_access_url,
                    speaker_diarization=True,
                ))
            elif isinstance(provider, ParaformerASR) and is_local:
                if expected_duration > 900:
                    raise RuntimeError(
                        "本地长音频 Paraformer 实时转写超时，且当前没有可用的远程 ASR 兜底；"
                        "请将 AUDIO_STORAGE_BACKEND 切到 oss 后重试。"
                    ) from timeout_err
                fallback_provider = "paraformer"
                fallback_reason = "paraformer_timeout_retry_small_chunks"
                source_meta.update({
                    "fallback_provider": fallback_provider,
                    "fallback_reason": fallback_reason,
                })
                _run_async(_update_task_source_meta(
                    task_id,
                    fallback_provider=fallback_provider,
                    fallback_reason=fallback_reason,
                ))
                transcription = provider.transcribe_local_sync(
                    audio_access_url,
                    speaker_diarization=True,
                    expected_duration=expected_duration,
                    chunk_seconds=180,
                )
            else:
                raise timeout_err

        # 4) 保存结果（async，短操作）
        transcript_raw = {
            "segments": [
                {"start": s.start, "end": s.end, "text": s.text, "speaker": s.speaker}
                for s in transcription.segments
            ],
            "speakers": transcription.speakers,
            "language": transcription.language,
            "duration": transcription.duration or prev_result.get("duration", 0),
            "_source_meta": source_meta,
        }

        duration = transcription.duration or prev_result.get("duration", 0)
        cost_rate = 0.6 if "tingwu" in effective_asr_model else 0.288
        cost = duration / 3600 * cost_rate

        async def _save_results():
            await _update_task_status(
                task_id, TaskStatus.summarizing,
                transcript_raw=transcript_raw,
                transcript_text=transcription.text,
            )
            await _log_usage(
                task_id, prev_result["user_id"],
                ServiceType.asr, effective_asr_model, effective_asr_model,
                audio_seconds=int(duration),
                estimated_cost=round(cost, 4),
            )

        _run_async(_save_results())

        return {
            **prev_result,
            "transcript_text": transcription.text,
            "transcript_raw": transcript_raw,
            "asr_cost": cost,
            "source_meta": source_meta,
        }
    except Exception as err:
        logger.exception(f"[Step 2] 失败: {task_id}: {err}")
        _run_async(_mark_task_failed(task_id, err))
        raise


# ============================================================
# Step 3: LLM 知识萃取
# ============================================================

@celery_app.task(bind=True, name="llm_summarize")
def llm_summarize(self, prev_result: dict) -> dict:
    """Prompt 模板渲染 + LLM 调用"""
    task_id = prev_result["task_id"]
    logger.info(f"[Step 3] LLM 知识萃取: {task_id}")

    async def _summarize():
        from app.services.llm_service import LLMService
        from app.services.prompt_service import render_prompt, build_template_context
        from app.services.asr_service import TranscriptionResult, Segment

        async with _make_session()() as db:
            result = await db.execute(select(AudioTask).where(AudioTask.id == uuid.UUID(task_id)))
            task = result.scalar_one()
            default_endpoint_id = next((
                candidate.strip() for candidate in [
                    os.getenv("DEFAULT_LLM_ENDPOINT_ID"),
                    settings.default_llm_endpoint_id,
                    os.getenv("DOUBAO_ENDPOINT_ID"),
                    settings.doubao_endpoint_id,
                ]
                if candidate and candidate.strip().startswith("ep-")
            ), "")
            default_llm_model = default_endpoint_id if (default_endpoint_id and settings.ark_api_key) else ""
            if not default_llm_model and settings.dashscope_api_key:
                default_llm_model = "dashscope/qwen-flash"
            requested_model = (task.llm_model or "").strip()
            if requested_model == "__default_doubao_endpoint__":
                llm_model = default_endpoint_id or default_llm_model
            else:
                llm_model = requested_model or default_llm_model
            if not llm_model:
                raise ValueError("未配置可用的默认 LLM。豆包请填写 DEFAULT_LLM_ENDPOINT_ID=ep-...，否则至少配置 DashScope 回退模型。")
            user_instruction = task.user_instruction or ""
            title = task.title

            # 获取 Prompt 模板
            template_text = ""
            if task.prompt_template_id:
                tpl_result = await db.execute(
                    select(PromptTemplate).where(PromptTemplate.id == task.prompt_template_id)
                )
                tpl = tpl_result.scalar_one_or_none()
                if tpl:
                    template_text = tpl.template_text

        if not template_text:
            # 使用默认深度学习模板
            from app.services.prompt_service import PRESET_TEMPLATES
            template_text = PRESET_TEMPLATES[0]["template_text"]

        # 重建 TranscriptionResult
        raw = prev_result.get("transcript_raw", {})
        segments = [
            Segment(start=s["start"], end=s["end"], text=s["text"], speaker=s.get("speaker"))
            for s in raw.get("segments", [])
        ]
        transcript_result = TranscriptionResult(
            text=prev_result.get("transcript_text", ""),
            segments=segments,
            speakers=raw.get("speakers", []),
            language=raw.get("language", "zh"),
            duration=raw.get("duration", 0),
        )

        if not _has_valid_transcript(transcript_result.text, segments):
            raise RuntimeError("[EMPTY_TRANSCRIPT] ASR 未产出有效逐字稿，已阻断摘要步骤")

        # 构建上下文并渲染 Prompt
        context = build_template_context(transcript_result, title, user_instruction)
        rendered = render_prompt(template_text, context)

        # 调用 LLM
        llm_service = LLMService()
        llm_result = await llm_service.summarize_long_text(
            transcript=transcript_result.text,
            rendered_prompt=rendered,
            model=llm_model,
        )

        # 保存结果
        summary = {
            "text": llm_result.text,
            "model": llm_result.model,
            "input_tokens": llm_result.input_tokens,
            "output_tokens": llm_result.output_tokens,
        }
        if prev_result.get("source_meta"):
            summary["_source_meta"] = prev_result.get("source_meta")
        callback_meta = {}
        if prev_result.get("webhook_url"):
            callback_meta["webhook_url"] = prev_result.get("webhook_url")
        if prev_result.get("article_id") is not None:
            callback_meta["article_id"] = prev_result.get("article_id")
        if callback_meta:
            summary["_callback"] = callback_meta
        await _update_task_status(task_id, TaskStatus.generating, summary_result=summary)

        # 记录用量
        await _log_usage(
            task_id, prev_result["user_id"],
            ServiceType.llm, llm_result.provider or llm_model.split("/")[0], llm_result.model,
            endpoint_id=llm_result.endpoint_id,
            input_tokens=llm_result.input_tokens,
            output_tokens=llm_result.output_tokens,
            total_tokens=llm_result.total_tokens,
            estimated_cost=round(
                llm_result.input_tokens / 1_000_000 * 0.15 + llm_result.output_tokens / 1_000_000 * 1.5, 4
            ),
            latency_ms=llm_result.latency_ms,
            provider_request_id=llm_result.provider_request_id,
            api_kind=llm_result.api_kind,
            prompt_preview=rendered,
            response_preview=llm_result.text,
            label=title,
        )

        return {
            **prev_result,
            "summary_text": llm_result.text,
            "llm_cost": llm_result.input_tokens / 1_000_000 * 0.15 + llm_result.output_tokens / 1_000_000 * 1.5,
        }

    try:
        return _run_async(_summarize())
    except Exception as err:
        logger.exception(f"[Step 3] 失败: {task_id}: {err}")
        _run_async(_mark_task_failed(task_id, err))
        raise


# ============================================================
# Step 4: 多模态生成（可选）
# ============================================================

@celery_app.task(bind=True, name="multimodal_generate")
def multimodal_generate(self, prev_result: dict) -> dict:
    """根据 Prompt 模板类别决定是否生成多模态内容"""
    task_id = prev_result["task_id"]
    logger.info(f"[Step 4] 多模态生成: {task_id}")

    async def _generate():
        async with _make_session()() as db:
            result = await db.execute(select(AudioTask).where(AudioTask.id == uuid.UUID(task_id)))
            task = result.scalar_one()

            # 检查是否需要多模态生成
            need_multimodal = False
            if task.prompt_template_id:
                tpl_result = await db.execute(
                    select(PromptTemplate).where(PromptTemplate.id == task.prompt_template_id)
                )
                tpl = tpl_result.scalar_one_or_none()
                if tpl and tpl.category == "multimodal":
                    need_multimodal = True

        if not need_multimodal:
            logger.info(f"[Step 4] 跳过多模态生成: {task_id}")
            return prev_result

        # 从摘要结果中提取配图 Prompt
        summary_text = prev_result.get("summary_text", "")
        image_prompts = _extract_image_prompts(summary_text)

        if not image_prompts:
            return prev_result

        from app.services.multimodal_service import get_multimodal_provider

        try:
            provider = get_multimodal_provider("wanxiang")
            images = []
            for prompt in image_prompts[:3]:  # 最多 3 张
                img_result = await provider.generate_image(prompt)
                images.append({"url": img_result.url, "prompt": prompt})

            await _update_task_status(task_id, TaskStatus.generating, multimodal_result={"images": images})

            # 记录用量
            await _log_usage(
                task_id, prev_result["user_id"],
                ServiceType.multimodal, "wanxiang", "wanx2.1-t2i-turbo",
                estimated_cost=round(len(images) * 0.06, 4),
            )

            return {**prev_result, "images": images}
        except Exception as e:
            logger.warning(f"多模态生成失败（非致命）: {e}")
            return prev_result

    return _run_async(_generate())


def _extract_image_prompts(summary_text: str) -> list[str]:
    """从 LLM 输出中提取配图描述 Prompt"""
    prompts = []
    lines = summary_text.split("\n")
    for i, line in enumerate(lines):
        if "配图描述" in line or "image prompt" in line.lower():
            # 取下一行或当前行冒号后的内容
            if "：" in line:
                prompts.append(line.split("：", 1)[1].strip())
            elif ":" in line:
                prompts.append(line.split(":", 1)[1].strip())
            elif i + 1 < len(lines):
                prompts.append(lines[i + 1].strip())
    return [p for p in prompts if p and len(p) > 5]


# ============================================================
# Step 5: 后处理
# ============================================================

@celery_app.task(bind=True, name="post_process")
def post_process(self, prev_result: dict) -> dict:
    """自动提取标签 + 费用汇总 + 状态更新为完成"""
    task_id = prev_result["task_id"]
    logger.info(f"[Step 5] 后处理: {task_id}")

    async def _post():
        # 自动提取标签（简单实现：从摘要中提取 # 标签）
        summary_text = prev_result.get("summary_text", "")
        transcript_text = prev_result.get("transcript_text", "")
        if not _has_valid_transcript(transcript_text):
            raise RuntimeError("[EMPTY_TRANSCRIPT] 缺少有效逐字稿，任务不能标记为完成")
        if not _normalize_transcript_text(summary_text):
            raise RuntimeError("[EMPTY_SUMMARY] 缺少有效摘要，任务不能标记为完成")
        tags = _extract_tags(summary_text)

        total_cost = prev_result.get("asr_cost", 0) + prev_result.get("llm_cost", 0)

        await _update_task_status(
            task_id, TaskStatus.done,
            tags=tags if tags else None,
            asr_cost=round(prev_result.get("asr_cost", 0), 4),
            llm_cost=round(prev_result.get("llm_cost", 0), 4),
            processing_finished_at=datetime.now(timezone.utc),
        )

        logger.info(f"[完成] 任务 {task_id} 处理完成，总费用: {total_cost:.4f} 元")

        # Webhook 回调（podcast RSS 自动转写）
        webhook_url = prev_result.get("webhook_url")
        if webhook_url:
            async with _make_session()() as db:
                result = await db.execute(select(AudioTask).where(AudioTask.id == uuid.UUID(task_id)))
                task = result.scalar_one_or_none()
                if task:
                    import httpx

                    secret = settings.audio_webhook_secret
                    payload = {
                        "task_id": task_id,
                        "status": "done",
                        "article_id": prev_result.get("article_id"),
                        "transcript": task.transcript_text,
                        "knowledge": prev_result.get("summary_text"),
                        "cost": round(total_cost, 4),
                        "duration": task.audio_duration,
                        "source_meta": prev_result.get("source_meta") or {},
                    }
                    headers = {"Content-Type": "application/json"}
                    if secret:
                        headers["X-Webhook-Secret"] = secret
                    try:
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            r = await client.post(webhook_url, json=payload, headers=headers)
                            r.raise_for_status()
                            logger.info(f"[webhook] 回调成功: {webhook_url}")
                    except Exception as e:
                        logger.error(f"[webhook] 回调失败 {webhook_url}: {e}")

        return {"task_id": task_id, "status": "done", "total_cost": total_cost}

    try:
        return _run_async(_post())
    except Exception as err:
        logger.exception(f"[Step 5] 失败: {task_id}: {err}")
        _run_async(_mark_task_failed(task_id, err))
        raise


def _extract_tags(text: str) -> list[str]:
    """从文本中提取 #标签"""
    import re
    tags = re.findall(r"#(\w+)", text)
    return list(set(tags))[:10]  # 最多 10 个标签
