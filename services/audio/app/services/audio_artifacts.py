"""从已保存的 ASR 时间轴和 AI 纪要构建版本化音频资产。"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any


ARTIFACT_SCHEMA = "audio_artifacts_v1"
HIGHLIGHT_PATTERN = re.compile(r"决定|行动|建议|关键|结论|风险|争议|需要|确认|证据|下一步|待办")
ACTION_PATTERN = re.compile(r"下一步|待办|行动|负责|跟进|需要|建议|截止")
TIMESTAMP_PATTERN = re.compile(r"\[(\d{1,3}:\d{2}(?::\d{2})?)\]")
TRANSCRIPT_SECTION_PATTERN = re.compile(r"逐字稿|完整转写|全文转写|原始转写|转写原文|全文记录|transcript", re.I)
MARKDOWN_SEPARATOR_PATTERN = re.compile(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$")
MARKDOWN_TABLE_DELIMITER_PATTERN = re.compile(r"^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$")
STRONG_HIGHLIGHT_PATTERN = re.compile(r"决定|行动|建议|关键|核心|结论|风险|争议|确认|证据|下一步|待办|必须|应该|负责")
ACTION_INTENT_PATTERN = re.compile(
    r"需要.{0,16}(?:完成|补齐|建立|确认|处理|解决|检查|跟进|配置|执行|验证|整理|修改|提供|推进)"
)


def _clean(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[`*_>#]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _is_markdown_table_row(value: str) -> bool:
    line = str(value or "").strip()
    if MARKDOWN_TABLE_DELIMITER_PATTERN.match(line):
        return True
    return line.count("|") >= 2 and (line.startswith("|") or line.endswith("|"))


def _is_structure_noise(value: str) -> bool:
    line = str(value or "").strip()
    if not line:
        return True
    return bool(
        MARKDOWN_SEPARATOR_PATTERN.match(line)
        or _is_markdown_table_row(line)
        or re.match(r"^</?(?:table|thead|tbody|tr|th|td)\b", line, re.I)
    )


def _is_insight_text(value: str, *, max_length: int = 500) -> bool:
    raw = str(value or "").strip()
    cleaned = _clean(raw)
    if not cleaned or len(cleaned) < 6 or len(cleaned) > max_length:
        return False
    if _is_structure_noise(raw) or TRANSCRIPT_SECTION_PATTERN.fullmatch(cleaned):
        return False
    signal_chars = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]", "", cleaned)
    return len(signal_chars) >= 4


def _iter_summary_signal_lines(markdown: str):
    """遍历可用于派生资产的纪要行，跳过表格、分隔符和完整逐字稿章节。"""

    skip_transcript_section = False
    for raw_line in str(markdown or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", line)
        if heading:
            title = _clean(heading.group(2))
            skip_transcript_section = bool(TRANSCRIPT_SECTION_PATTERN.search(title))
            if skip_transcript_section:
                continue
        if skip_transcript_section or _is_structure_noise(line):
            continue
        yield line


def _summary_sections(markdown: str) -> tuple[str, list[dict]]:
    root = ""
    sections: list[dict] = []
    current: dict | None = None
    for line in _iter_summary_signal_lines(markdown):
        heading = re.match(r"^(#{1,4})\s+(.+)$", line)
        if heading:
            title = _clean(heading.group(2))
            if len(heading.group(1)) == 1 and not root:
                root = title
                current = None
                continue
            current = {"title": title, "paragraphs": [], "bullets": []}
            sections.append(current)
            continue
        if current is None:
            current = {"title": "内容总结", "paragraphs": [], "bullets": []}
            sections.append(current)
        bullet = re.match(r"^(?:[-*]\s+|\d+[.)、]\s*)(.+)$", line)
        content = _clean(bullet.group(1) if bullet else line)
        if not _is_insight_text(content):
            continue
        target = "bullets" if bullet else "paragraphs"
        current[target].append(content)
    return root, [section for section in sections if section["paragraphs"] or section["bullets"]]


def _segments(transcript_raw: dict | None) -> list[dict]:
    raw_segments = (transcript_raw or {}).get("segments") or []
    normalized = []
    for item in raw_segments:
        if not isinstance(item, dict):
            continue
        text = _clean(item.get("text"))
        if not text or len(text) > 1000 or _is_structure_noise(str(item.get("text") or "")):
            continue
        try:
            start = max(0.0, float(item.get("start") or 0))
            end = max(start, float(item.get("end") or start))
        except (TypeError, ValueError):
            continue
        normalized.append({
            "start": start,
            "end": end,
            "text": text,
            "speaker": _clean(item.get("speaker")) or None,
        })
    return sorted(normalized, key=lambda item: (item["start"], item["end"]))


def _group_segments(segments: list[dict], count: int) -> list[list[dict]]:
    if not segments or count <= 0:
        return [[] for _ in range(max(1, count))]
    groups: list[list[dict]] = []
    for index in range(count):
        start = index * len(segments) // count
        end = (index + 1) * len(segments) // count
        groups.append(segments[start:end])
    return groups


def _timestamp_seconds(value: str) -> float:
    parts = [int(part) for part in value.split(":")]
    if len(parts) == 2:
        return float(parts[0] * 60 + parts[1])
    return float(parts[0] * 3600 + parts[1] * 60 + parts[2])


def _timestamped_topics(markdown: str) -> list[dict]:
    topics = []
    for raw_line in _iter_summary_signal_lines(markdown):
        matches = list(TIMESTAMP_PATTERN.finditer(raw_line))
        if not matches:
            continue
        text = TIMESTAMP_PATTERN.sub("", raw_line)
        text = re.sub(r"^\s*(?:[-*]|\d+[.)、])\s*", "", text)
        text = _clean(text).strip(" |—–-：:")
        if not _is_insight_text(text):
            continue
        for match in matches:
            topics.append({"time": _timestamp_seconds(match.group(1)), "text": text})

    clusters: list[dict] = []
    for topic in sorted(topics, key=lambda item: item["time"]):
        if clusters and topic["time"] - clusters[-1]["time"] < 240:
            if topic["text"] not in clusters[-1]["texts"]:
                clusters[-1]["texts"].append(topic["text"])
            continue
        clusters.append({"time": topic["time"], "texts": [topic["text"]]})
    return clusters[:11]


def _segment_index_at_or_after(segments: list[dict], timestamp: float) -> int:
    for index, segment in enumerate(segments):
        if segment["start"] >= timestamp:
            return index
    return max(0, len(segments) - 1)


def _topic_title(text: str) -> str:
    normalized = text.strip()
    if (normalized.startswith("“") and normalized.endswith("”")) or (
        normalized.startswith(('"', "'")) and normalized.endswith(normalized[0])
    ):
        normalized = normalized[1:-1].strip()
    if "|" in normalized:
        normalized = next((part.strip() for part in normalized.split("|") if part.strip()), normalized)
    normalized = re.sub(r"\s*——.*$", "", normalized).strip()
    if "：" in normalized and len(normalized.split("：", 1)[0]) >= 4:
        normalized = normalized.split("：", 1)[0]
    if len(normalized) > 32:
        normalized = normalized[:32].rstrip("，。；;、 ") + "…"
    return normalized or "主题片段"


def _build_timed_chapters(topics: list[dict], segments: list[dict]) -> list[dict]:
    if len(topics) < 2 or not segments:
        return []

    anchors = []
    first_start = segments[0]["start"]
    if topics[0]["time"] - first_start > 90:
        anchors.append({"index": 0, "title": "开场与背景", "texts": []})

    for topic in topics:
        index = _segment_index_at_or_after(segments, topic["time"])
        if anchors and index <= anchors[-1]["index"]:
            anchors[-1]["texts"].extend(
                text for text in topic["texts"] if text not in anchors[-1]["texts"]
            )
            continue
        anchors.append({
            "index": index,
            "title": _topic_title(topic["texts"][0]),
            "texts": list(topic["texts"]),
        })

    if anchors and anchors[0]["index"] > 0:
        anchors[0]["index"] = 0

    chapters = []
    for index, anchor in enumerate(anchors):
        next_index = anchors[index + 1]["index"] if index + 1 < len(anchors) else len(segments)
        group = segments[anchor["index"]:next_index]
        if not group:
            continue
        summary = anchor["texts"][0] if anchor["texts"] else group[0]["text"]
        speakers = sorted({item["speaker"] for item in group if item.get("speaker")})
        chapters.append({
            "id": f"chapter-{len(chapters) + 1}",
            "title": anchor["title"],
            "summary": summary,
            "bullets": anchor["texts"][1:6],
            "start": group[0]["start"],
            "end": group[-1]["end"],
            "speakers": speakers,
            "source": "summary_timestamp+asr",
        })
    return chapters


def _build_chapters(title: str, sections: list[dict], segments: list[dict]) -> list[dict]:
    if not sections:
        if not segments:
            return []
        section_count = min(10, max(1, (len(segments) + 5 - 1) // 5))
        groups = _group_segments(segments, section_count)
        sections = [
            {
                "title": "开场与核心问题" if index == 0 else f"片段 {index + 1}",
                "paragraphs": [group[0]["text"]] if group else [],
                "bullets": [item["text"] for item in group[1:5]],
            }
            for index, group in enumerate(groups)
        ]
    groups = _group_segments(segments, len(sections))
    chapters = []
    for index, section in enumerate(sections[:12]):
        group = groups[index] if index < len(groups) else []
        summary = (section["paragraphs"] or section["bullets"] or ["暂无可读摘要"])[0]
        speakers = sorted({item["speaker"] for item in group if item.get("speaker")})
        chapters.append({
            "id": f"chapter-{index + 1}",
            "title": section["title"] or (title if index == 0 else f"章节 {index + 1}"),
            "summary": summary,
            "bullets": section["bullets"][:6],
            "start": group[0]["start"] if group else None,
            "end": group[-1]["end"] if group else None,
            "speakers": speakers,
            "source": "summary+asr" if group else "summary",
        })
    return chapters


def _build_highlights(chapters: list[dict], segments: list[dict]) -> list[dict]:
    candidates = []
    for item in segments:
        text = item["text"]
        if not HIGHLIGHT_PATTERN.search(text) or not _is_insight_text(text, max_length=260):
            continue
        if not STRONG_HIGHLIGHT_PATTERN.search(text) and not ACTION_INTENT_PATTERN.search(text):
            continue
        score = 1
        if STRONG_HIGHLIGHT_PATTERN.search(text):
            score += 3
        if 18 <= len(text) <= 160:
            score += 2
        if ACTION_PATTERN.search(text):
            score += 1
        candidates.append((score, item))

    selected = []
    seen_texts: set[str] = set()
    latest_start = max((item["start"] for _, item in candidates), default=0)
    minimum_gap = 90 if latest_start >= 600 else 15
    for _, item in sorted(candidates, key=lambda entry: (-entry[0], entry[1]["start"])):
        identity = re.sub(r"\W+", "", item["text"]).lower()
        if not identity or identity in seen_texts:
            continue
        if any(abs(item["start"] - existing["start"]) < minimum_gap for existing in selected):
            continue
        seen_texts.add(identity)
        selected.append(item)
        if len(selected) >= 8:
            break
    selected.sort(key=lambda item: item["start"])
    if selected:
        return [
            {
                "id": f"highlight-{index + 1}",
                "start": item["start"],
                "end": item["end"],
                "speaker": item.get("speaker"),
                "title": "关键决策与行动" if ACTION_PATTERN.search(item["text"]) else "关键原话",
                "text": item["text"],
                "reason": "来自 ASR 时间轴，命中决策、风险、证据或行动表达。",
                "source": "asr",
            }
            for index, item in enumerate(selected)
        ]
    return [
        {
            "id": f"highlight-{index + 1}",
            "start": chapter.get("start"),
            "end": chapter.get("end"),
            "speaker": None,
            "title": chapter["title"],
            "text": chapter["summary"],
            "reason": "来自 AI 纪要章节，适合快速复盘。",
            "source": "summary",
        }
        for index, chapter in enumerate(chapters[:5])
        if _is_insight_text(chapter.get("summary"), max_length=320)
    ]


def _build_actions(sections: list[dict]) -> list[dict]:
    candidates = []
    for section in sections:
        for text in [*section["bullets"], *section["paragraphs"]]:
            if ACTION_PATTERN.search(text):
                candidates.append(text)
    unique = list(dict.fromkeys(candidates))[:12]
    return [
        {
            "id": f"action-{index + 1}",
            "text": text,
            "owner": None,
            "due_at": None,
            "status": "open",
            "source": "summary",
        }
        for index, text in enumerate(unique)
    ]


def preserve_audio_qa_answers(artifacts: dict, previous_artifacts: Any) -> dict:
    """重建章节和高光时保留已验证、可回听的问答资产。"""

    if not isinstance(previous_artifacts, dict):
        return artifacts
    previous_qa = previous_artifacts.get("qa")
    previous_answers = previous_qa.get("answers") if isinstance(previous_qa, dict) else None
    if not isinstance(previous_answers, list):
        return artifacts
    answers = [
        answer
        for answer in previous_answers
        if isinstance(answer, dict)
        and _clean(answer.get("question"))
        and _clean(answer.get("answer"))
        and isinstance(answer.get("citations"), list)
        and answer.get("citations")
    ]
    if answers:
        qa = artifacts.get("qa") if isinstance(artifacts.get("qa"), dict) else {}
        artifacts["qa"] = {**qa, "answers": answers}
    return artifacts


def build_audio_artifacts_v1(
    *,
    title: str,
    summary_text: str,
    transcript_text: str,
    transcript_raw: dict | None,
) -> dict:
    root, sections = _summary_sections(summary_text)
    segments = _segments(transcript_raw)
    topics = _timestamped_topics(summary_text)
    chapters = _build_timed_chapters(topics, segments) or _build_chapters(title, sections, segments)
    mind_map = {
        "root": root or title or "音频纪要",
        "branches": [
            {
                "title": chapter["title"],
                "children": (chapter["bullets"] or [chapter["summary"]])[:5],
                "chapter_id": chapter["id"],
            }
            for chapter in chapters[:8]
        ],
    }
    safe_title = root or title or "这段听记"
    qa = {
        "suggestions": [
            {"key": "summary", "label": "总结核心观点", "prompt": f"总结《{safe_title}》的核心观点与证据。"},
            {"key": "actions", "label": "整理行动项", "prompt": f"从《{safe_title}》中提取负责人、时间和依赖。"},
            {"key": "risks", "label": "查找风险与假设", "prompt": f"分析《{safe_title}》中的风险、分歧和待验证假设。"},
            {"key": "quotes", "label": "定位关键原话", "prompt": f"返回《{safe_title}》中最值得回听的原话和时间段。"},
        ],
        "answers": [],
    }
    return {
        "schema": ARTIFACT_SCHEMA,
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "basis": {
            "summary": bool(_clean(summary_text)),
            "transcript": bool(_clean(transcript_text)),
            "timed_segments": len(segments),
            "topic_anchors": len(topics),
        },
        "chapters": chapters,
        "highlights": _build_highlights(chapters, segments),
        "mind_map": mind_map,
        "action_items": _build_actions(sections),
        "qa": qa,
    }
