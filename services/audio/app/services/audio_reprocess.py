"""音频任务按失败阶段恢复的纯逻辑。"""

from __future__ import annotations

from typing import Literal


AudioReprocessStage = Literal["full", "summary"]
VALID_REPROCESS_STAGES = frozenset({"auto", "full", "summary"})


def has_reusable_transcript(transcript_text: str | None, transcript_raw: dict | None) -> bool:
    normalized = " ".join((transcript_text or "").split()).strip()
    if len(normalized) >= 80:
        return True

    segments = transcript_raw.get("segments") if isinstance(transcript_raw, dict) else None
    if not isinstance(segments, list):
        return False
    return any(
        isinstance(segment, dict) and bool(" ".join(str(segment.get("text") or "").split()).strip())
        for segment in segments
    )


def has_reusable_summary(summary_result: dict | None) -> bool:
    if not isinstance(summary_result, dict):
        return False
    text = summary_result.get("text")
    return isinstance(text, str) and len(" ".join(text.split()).strip()) >= 20


def resolve_effective_task_status(
    status: str,
    *,
    transcript_text: str | None,
    transcript_raw: dict | None,
    summary_result: dict | None,
) -> str:
    """历史重试失败不能覆盖已经可用的转写和纪要。"""
    normalized_status = getattr(status, "value", status)
    if (
        normalized_status == "failed"
        and has_reusable_transcript(transcript_text, transcript_raw)
        and has_reusable_summary(summary_result)
    ):
        return "done"
    return str(normalized_status)


def resolve_reprocess_stage(
    requested_stage: str | None,
    *,
    transcript_text: str | None,
    transcript_raw: dict | None,
) -> AudioReprocessStage:
    normalized = (requested_stage or "auto").strip().lower()
    if normalized not in VALID_REPROCESS_STAGES:
        raise ValueError("重跑阶段只支持 auto、full 或 summary")

    transcript_ready = has_reusable_transcript(transcript_text, transcript_raw)
    if normalized == "auto":
        return "summary" if transcript_ready else "full"
    if normalized == "summary" and not transcript_ready:
        raise ValueError("当前任务没有可复用的逐字稿，不能只重做纪要，请改为重新转写")
    return normalized  # type: ignore[return-value]


def metadata_only_summary(
    summary_result: dict | None,
    transcript_raw: dict | None,
    *,
    preserve_artifacts: bool,
) -> dict | None:
    """重跑纪要时保留上一次可用结果，成功后再由新结果整体替换。"""
    source = summary_result if isinstance(summary_result, dict) else {}
    transcript_source = transcript_raw if isinstance(transcript_raw, dict) else {}
    result: dict = {}

    source_meta = transcript_source.get("_source_meta") or source.get("_source_meta")
    if isinstance(source_meta, dict):
        result["_source_meta"] = dict(source_meta)

    callback = source.get("_callback")
    if isinstance(callback, dict):
        result["_callback"] = dict(callback)

    if preserve_artifacts:
        if has_reusable_summary(source):
            result["text"] = source["text"]
            for key in ("model", "input_tokens", "output_tokens"):
                if source.get(key) is not None:
                    result[key] = source[key]

        artifacts = source.get("artifacts")
        if isinstance(artifacts, dict):
            result["artifacts"] = dict(artifacts)

    return result or None
