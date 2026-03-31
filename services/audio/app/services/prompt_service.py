"""Prompt 模板引擎 — Jinja2 渲染 + 预设模板"""

from jinja2 import Template, Environment, BaseLoader
from app.services.asr_service import TranscriptionResult


def format_duration(seconds: float) -> str:
    """秒数 → '1小时23分' 格式"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    if hours > 0:
        return f"{hours}小时{minutes}分"
    return f"{minutes}分钟"


def build_template_context(
    transcript_result: TranscriptionResult,
    audio_title: str = "",
    user_instruction: str = "",
) -> dict:
    """从 ASR 结果构建模板渲染上下文"""
    # 带时间戳的逐字稿
    transcript_with_ts = ""
    for seg in transcript_result.segments:
        ts = f"[{int(seg.start//60):02d}:{int(seg.start%60):02d}]"
        speaker = f"({seg.speaker}) " if seg.speaker else ""
        transcript_with_ts += f"{ts} {speaker}{seg.text}\n"

    return {
        "transcript": transcript_with_ts or transcript_result.text,
        "transcript_plain": transcript_result.text,
        "speakers": transcript_result.speakers,
        "duration": transcript_result.duration,
        "duration_formatted": format_duration(transcript_result.duration),
        "language": transcript_result.language,
        "user_instruction": user_instruction,
        "audio_title": audio_title,
    }


def render_prompt(template_text: str, context: dict) -> str:
    """渲染 Jinja2 模板"""
    env = Environment(loader=BaseLoader())
    template = env.from_string(template_text)
    return template.render(**context)


# ============================================================
# 预设 Prompt 模板
# ============================================================

PRESET_TEMPLATES = [
    {
        "name": "深度学习模式",
        "description": "适用于播客、演讲、技术分享。提取核心论点、关键洞察、金句和行动建议。",
        "category": "deep_learning",
        "template_text": """你是一位资深知识萃取专家。请对以下音频逐字稿进行深度分析和知识萃取。

音频标题：{{ audio_title }}
时长：{{ duration_formatted }}
{% if speakers %}说话人：{{ speakers | join(', ') }}{% endif %}

---

请按以下结构输出：

## 核心论点（3-5 个）
每个论点用一句话概括，附上对应的时间戳 [MM:SS]。

## 关键洞察
提取超出常识的、有启发性的观点。说明为什么这个观点重要。

## 类比与案例
列出音频中用于解释复杂概念的类比和案例，说明其映射关系。

## 对立观点（如有）
如果音频中存在争议性内容或不同立场，列出对立面。

## 金句提取（3-5 句）
提取原话中最有力量的句子，标注说话人和时间戳。

## 行动建议
基于以上内容，给出 2-3 条可执行的行动建议。

## 一句话总结
用一句话概括这段音频的核心价值。

---

逐字稿：
{{ transcript }}

{% if user_instruction %}
用户附加要求：{{ user_instruction }}
{% endif %}""",
        "variables": ["transcript", "transcript_plain", "speakers", "duration_formatted", "audio_title", "user_instruction"],
    },
    {
        "name": "会议纪要模式",
        "description": "适用于团队会议、1:1 面谈、项目评审。提取决策、待办和跟进事项。",
        "category": "meeting",
        "template_text": """你是一位专业的会议纪要助手。请对以下会议录音逐字稿进行结构化整理。

会议标题：{{ audio_title }}
时长：{{ duration_formatted }}
{% if speakers %}参会人：{{ speakers | join(', ') }}{% endif %}

---

请按以下结构输出：

## 会议摘要
用 2-3 句话概括会议核心内容。

## 议题与讨论
按讨论顺序列出各议题，每个议题包含：
- 议题名称
- 主要讨论内容（简述）
- 关键时间点 [MM:SS]

## 决策事项
| 决策 | 决策人 | 时间戳 |
|------|--------|--------|

## 待办事项 (TODOs)
| 事项 | 负责人 | 截止日（如提及） | 时间戳 |
|------|--------|-------------------|--------|

## 待跟进问题
列出未达成共识或需要进一步讨论的问题。

## 下次会议
如果提到了下次会议的时间或议题，在此列出。

---

逐字稿：
{{ transcript }}

{% if user_instruction %}
用户附加要求：{{ user_instruction }}
{% endif %}""",
        "variables": ["transcript", "speakers", "duration_formatted", "audio_title", "user_instruction"],
    },
    {
        "name": "日记/口述模式",
        "description": "适用于晨间日记、灵感录音、碎碎念。整理情绪、计划和思维线索。",
        "category": "diary",
        "template_text": """你是一位善于倾听的个人助理。请对以下口述录音进行整理和分析。

标题：{{ audio_title }}
时长：{{ duration_formatted }}

---

请按以下结构输出：

## 情绪基调
用一句话描述整段录音的情绪氛围（如：积极且充满期待、焦虑中带着决心）。

## 今日重点
提取录音中提到的核心计划、事件或想法（按重要性排序）。

## 思维线索
识别反复出现的主题或关注点，可能是潜意识中的重要信号。

## 灵感火花
如果有创意想法或突发灵感，单独列出。

## 情绪流动
按时间顺序描述情绪的变化轨迹（如果有明显波动）。

## 标签
自动提取 3-5 个标签（如 #工作 #健康 #创业 #反思）。

---

逐字稿：
{{ transcript_plain }}

{% if user_instruction %}
用户附加要求：{{ user_instruction }}
{% endif %}""",
        "variables": ["transcript_plain", "duration_formatted", "audio_title", "user_instruction"],
    },
    {
        "name": "多模态内容生成",
        "description": "适用于需要配图的知识卡片、社交分享。生成观点卡片和配图 Prompt。",
        "category": "multimodal",
        "template_text": """你是一位内容创作专家。请基于以下音频逐字稿，生成适合社交媒体分享的内容。

标题：{{ audio_title }}
时长：{{ duration_formatted }}

---

请按以下结构输出：

## 核心观点卡片（3 张）
每张卡片包含：
- 标题（8 字以内）
- 正文（50 字以内，一个核心观点）
- 配图描述（用于 AI 生图的英文 Prompt，描述画面风格和内容）

## 金句海报（2 张）
每张包含：
- 金句原文
- 说话人
- 配图风格建议（如：极简、赛博朋克、水墨风等）

## 长文摘要
300 字以内的精华摘要，适合发朋友圈或公众号。

## 话题标签
5-8 个适合社交媒体的标签。

---

逐字稿：
{{ transcript }}

{% if user_instruction %}
用户附加要求：{{ user_instruction }}
{% endif %}""",
        "variables": ["transcript", "duration_formatted", "audio_title", "user_instruction"],
    },
]
