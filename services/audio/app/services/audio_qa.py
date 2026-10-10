"""基于 ASR 时间轴生成可回听、可验证的音频问答资产。"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any


PROMPT_HINTS = {
    "actions": "下一步 待办 行动 负责 跟进 需要 建议 计划",
    "risks": "风险 分歧 争议 假设 问题 不确定 阻碍 卡点",
    "quotes": "关键 原话 结论 判断 证据 争议 观点",
}


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _time_label(seconds: float) -> str:
    value = max(0, int(seconds))
    hours, remainder = divmod(value, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def _timestamp_seconds(value: Any) -> float | None:
    match = re.search(r"(?<!\d)(\d{1,2}:\d{2}(?::\d{2})?)(?!\d)", str(value or ""))
    if not match:
        return None
    parts = [int(part) for part in match.group(1).split(":")]
    if any(part >= 60 for part in parts[1:]):
        return None
    if len(parts) == 2:
        return float(parts[0] * 60 + parts[1])
    return float(parts[0] * 3600 + parts[1] * 60 + parts[2])


def _evidence_number_for_timestamp(seconds: float, evidence: list[dict]) -> int | None:
    for number, item in enumerate(evidence, start=1):
        if float(item["start"]) - 2 <= seconds <= float(item["end"]) + 2:
            return number
    if not evidence:
        return None
    nearest_number, nearest_item = min(
        enumerate(evidence, start=1),
        key=lambda entry: abs(float(entry[1]["start"]) - seconds),
    )
    return nearest_number if abs(float(nearest_item["start"]) - seconds) <= 45 else None


def _segments(transcript_raw: dict | None) -> list[dict]:
    normalized: list[dict] = []
    for raw in (transcript_raw or {}).get("segments") or []:
        if not isinstance(raw, dict):
            continue
        text = _clean(raw.get("text"))
        if not text:
            continue
        try:
            start = max(0.0, float(raw.get("start") or 0))
            end = max(start, float(raw.get("end") or start))
        except (TypeError, ValueError):
            continue
        normalized.append({
            "start": start,
            "end": end,
            "text": text,
            "speaker": _clean(raw.get("speaker")) or None,
        })
    return sorted(normalized, key=lambda item: (item["start"], item["end"]))


def _terms(value: str) -> set[str]:
    normalized = _clean(value).lower()
    terms = set(re.findall(r"[a-z0-9][a-z0-9_-]{2,}", normalized))
    for sequence in re.findall(r"[\u4e00-\u9fff]{2,}", normalized):
        terms.add(sequence)
        terms.update(sequence[index:index + 2] for index in range(len(sequence) - 1))
    return terms


def _evenly_spaced_indexes(length: int, limit: int) -> list[int]:
    if length <= limit:
        return list(range(length))
    if limit <= 1:
        return [0]
    return sorted({round(index * (length - 1) / (limit - 1)) for index in range(limit)})


def select_audio_qa_evidence(
    transcript_raw: dict | None,
    question: str,
    *,
    prompt_key: str | None = None,
    limit: int = 14,
) -> list[dict]:
    """选择少量真实 ASR 片段；总结类均匀取样，其他问题按词项相关性排序。"""
    segments = _segments(transcript_raw)
    if not segments:
        return []
    safe_limit = max(3, min(20, int(limit)))
    normalized_key = _clean(prompt_key).lower()

    if normalized_key == "summary":
        chosen = _evenly_spaced_indexes(len(segments), safe_limit)
        return [{**segments[index], "evidence_id": f"E{position + 1}"} for position, index in enumerate(chosen)]

    query_terms = _terms(question)
    query_terms.update(_terms(PROMPT_HINTS.get(normalized_key, "")))
    scored: list[tuple[int, int]] = []
    for index, segment in enumerate(segments):
        segment_terms = _terms(segment["text"])
        overlap = len(query_terms.intersection(segment_terms))
        exact_bonus = 2 if any(term in segment["text"].lower() for term in query_terms if len(term) >= 4) else 0
        scored.append((overlap * 4 + exact_bonus, index))

    positive = [item for item in sorted(scored, key=lambda item: (-item[0], item[1])) if item[0] > 0]
    chosen_indexes = [index for _, index in positive[:safe_limit]]
    if len(chosen_indexes) < min(6, safe_limit):
        for index in _evenly_spaced_indexes(len(segments), safe_limit):
            if index not in chosen_indexes:
                chosen_indexes.append(index)
            if len(chosen_indexes) >= safe_limit:
                break
    chosen_indexes = sorted(chosen_indexes[:safe_limit])
    return [
        {**segments[index], "evidence_id": f"E{position + 1}"}
        for position, index in enumerate(chosen_indexes)
    ]


def build_audio_qa_prompt(
    *,
    title: str,
    question: str,
    summary_text: str,
    evidence: list[dict],
) -> str:
    evidence_lines = []
    for item in evidence:
        speaker = f" {item['speaker']}" if item.get("speaker") else ""
        evidence_lines.append(
            f"[{item['evidence_id']} {_time_label(item['start'])}-{_time_label(item['end'])}{speaker}] {item['text']}"
        )
    return (
        "你是一个严格的音频证据助手。只能使用下方纪要和 ASR 证据回答，不得补写未出现的事实。\n"
        "请输出严格 JSON，格式为 "
        '{"answer":"Markdown 回答","citations":["E1","E2"]}'
        "。citations 必须填 E 编号，不要填时间点。answer 要先给结论，再给依据；"
        "每个关键判断都应在 citations 中引用至少一个证据 ID。\n\n"
        f"音频：{_clean(title)}\n"
        f"问题：{_clean(question)}\n\n"
        f"已有纪要：\n{str(summary_text or '')[:6000]}\n\n"
        "ASR 证据：\n" + "\n".join(evidence_lines)
    )


def _json_payload(raw_text: str) -> dict | None:
    text = str(raw_text or "").strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, flags=re.S | re.I)
    candidate = fenced.group(1) if fenced else text
    if not candidate.startswith("{"):
        start, end = candidate.find("{"), candidate.rfind("}")
        candidate = candidate[start:end + 1] if start >= 0 and end > start else ""
    if not candidate:
        return None
    try:
        value = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _nested_answer_payload(raw_text: str) -> dict | None:
    parsed = _json_payload(raw_text)
    if parsed:
        return parsed
    text = str(raw_text or "").strip()
    prefix = re.match(r'^\s*\{\s*"answer"\s*:\s*"', text)
    delimiters = list(re.finditer(r'"\s*,\s*"citations"\s*:\s*', text))
    if not prefix or not delimiters:
        return None
    delimiter = delimiters[-1]
    answer = text[prefix.end():delimiter.start()]
    citations_text = text[delimiter.end():].strip()
    if citations_text.endswith("}"):
        citations_text = citations_text[:-1].rstrip()
    try:
        citations = json.loads(citations_text)
    except json.JSONDecodeError:
        return None
    if not isinstance(citations, list):
        return None
    return {
        "answer": answer.replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\"),
        "citations": citations,
    }


def parse_audio_qa_response(raw_text: str, evidence: list[dict]) -> tuple[str, list[dict]]:
    payload = _json_payload(raw_text) or _nested_answer_payload(raw_text)
    if payload and isinstance(payload.get("answer"), str):
        nested_payload = _nested_answer_payload(payload["answer"])
        if nested_payload and isinstance(nested_payload.get("answer"), str):
            payload = nested_payload
    answer = str(payload.get("answer") if payload else raw_text or "").strip()
    if not answer:
        raise ValueError("AI 没有生成可用回答")

    raw_citations = payload.get("citations") if payload else []
    citation_numbers: list[int] = []
    citation_timestamps: list[float] = []
    for raw in raw_citations if isinstance(raw_citations, list) else []:
        value = raw.get("id") or raw.get("evidence_id") if isinstance(raw, dict) else raw
        match = re.fullmatch(r"\s*\[?E(\d+)\]?\s*", str(value or ""), flags=re.I)
        if match:
            citation_numbers.append(int(match.group(1)))
            continue
        timestamp_value = (
            raw.get("time")
            or raw.get("timestamp")
            or raw.get("start")
            or raw.get("time_label")
            if isinstance(raw, dict)
            else raw
        )
        timestamp = _timestamp_seconds(timestamp_value)
        if timestamp is not None:
            citation_timestamps.append(timestamp)
    if not citation_numbers:
        citation_numbers = [int(value) for value in re.findall(r"\[E(\d+)\]", answer, flags=re.I)]
    if not citation_numbers:
        citation_numbers = [int(value) for value in re.findall(r"\bE(\d+)\b", answer, flags=re.I)]
    citation_timestamps.extend(
        timestamp
        for timestamp in (
            _timestamp_seconds(value)
            for value in re.findall(
                r"\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?)?\]",
                answer,
            )
        )
        if timestamp is not None
    )
    for timestamp in citation_timestamps:
        number = _evidence_number_for_timestamp(timestamp, evidence)
        if number is not None:
            citation_numbers.append(number)

    citations: list[dict] = []
    for number in dict.fromkeys(citation_numbers):
        if number < 1 or number > len(evidence):
            continue
        item = evidence[number - 1]
        citations.append({
            "id": f"citation-{number}",
            "evidence_id": item["evidence_id"],
            "start": item["start"],
            "end": item["end"],
            "time_label": f"{_time_label(item['start'])}-{_time_label(item['end'])}",
            "text": item["text"],
            "speaker": item.get("speaker"),
            "source": "asr",
        })
    if not citations:
        raise ValueError("AI 回答没有可核验的时间引用，本次结果未保存")

    for number, item in enumerate(evidence, start=1):
        answer = re.sub(rf"\[E{number}\]", f"〔{_time_label(item['start'])}〕", answer, flags=re.I)
    answer = re.sub(
        r"\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([-–—])\s*(\d{1,2}:\d{2}(?::\d{2})?))?\]",
        lambda match: f"〔{match.group(1)}{(match.group(2) or '')}{(match.group(3) or '')}〕",
        answer,
    )
    return answer, citations


def build_audio_qa_answer(
    *,
    question: str,
    prompt_key: str | None,
    raw_response: str,
    evidence: list[dict],
    model: str,
    provider: str,
    input_tokens: int,
    output_tokens: int,
) -> dict:
    answer, citations = parse_audio_qa_response(raw_response, evidence)
    return {
        "id": str(uuid.uuid4()),
        "question": _clean(question),
        "prompt_key": _clean(prompt_key) or None,
        "answer": answer,
        "citations": citations,
        "status": "ready",
        "model": _clean(model),
        "provider": _clean(provider),
        "input_tokens": int(input_tokens or 0),
        "output_tokens": int(output_tokens or 0),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def upsert_audio_qa_answer(artifacts: dict, answer: dict) -> dict:
    updated = dict(artifacts or {})
    qa = dict(updated.get("qa") or {})
    answers = [item for item in (qa.get("answers") or []) if isinstance(item, dict)]
    prompt_key = _clean(answer.get("prompt_key"))
    question = _clean(answer.get("question"))
    answers = [
        item for item in answers
        if not (
            (prompt_key and _clean(item.get("prompt_key")) == prompt_key)
            or (not prompt_key and _clean(item.get("question")) == question)
        )
    ]
    qa["answers"] = (answers + [answer])[-30:]
    updated["qa"] = qa
    return updated
