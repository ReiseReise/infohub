"""音频工作坊的 Prompt 与 LLM 配置守卫。"""

from __future__ import annotations

from dataclasses import dataclass


AUDIO_PROMPT_CATEGORIES = frozenset({"deep_learning", "meeting", "diary", "multimodal"})
DEFAULT_ENDPOINT_SENTINEL = "__default_doubao_endpoint__"


def normalize_prompt_category(value: object) -> str:
    raw = getattr(value, "value", value)
    return str(raw or "").strip().lower()


def is_audio_prompt_category(value: object) -> bool:
    return normalize_prompt_category(value) in AUDIO_PROMPT_CATEGORIES


def validate_model_config_target(provider: str | None, model_name: str | None) -> tuple[str, str]:
    normalized_provider = (provider or "").strip().lower()
    normalized_model = (model_name or "").strip()
    if not normalized_provider:
        raise ValueError("请选择模型供应商，不能只保存模型名称")
    if not normalized_model:
        raise ValueError("请填写模型名称或 Endpoint ID")

    ark_providers = {"volcengine_ark", "doubao"}
    if normalized_model.startswith("ep-") and normalized_provider not in ark_providers:
        raise ValueError("ep- 开头的 Endpoint 必须绑定 Volcengine Ark 供应商")
    if normalized_provider in ark_providers and not normalized_model.startswith("ep-"):
        raise ValueError("Volcengine Ark 必须填写 Endpoint ID（ep-...）")
    if normalized_provider == "deepseek":
        if normalized_model in {"deepseek-v4-flash", "deepseek-v4-flash-vision-exp"}:
            normalized_model = "deepseek-flash"
        if normalized_model not in {"deepseek-flash", "deepseek-v4-pro"}:
            raise ValueError("DeepSeek 官方模型请使用 deepseek-flash 或 deepseek-v4-pro")
    return normalized_provider, normalized_model


@dataclass(frozen=True)
class AudioLlmSelection:
    model: str
    provider: str
    available: bool
    reason: str | None = None


def resolve_audio_llm_selection(
    requested_model: str | None,
    *,
    default_endpoint_id: str | None,
    has_ark_key: bool,
    has_dashscope_key: bool,
) -> AudioLlmSelection:
    requested = (requested_model or "").strip()
    endpoint = (default_endpoint_id or "").strip()

    if requested == DEFAULT_ENDPOINT_SENTINEL:
        if not endpoint.startswith("ep-"):
            return AudioLlmSelection("", "volcengine_ark", False, "默认豆包 Endpoint 尚未配置")
        if not has_ark_key:
            return AudioLlmSelection("", "volcengine_ark", False, "默认豆包 Endpoint 缺少 Ark API Key")
        return AudioLlmSelection(endpoint, "volcengine_ark", True)

    if not requested:
        if endpoint.startswith("ep-") and has_ark_key:
            return AudioLlmSelection(endpoint, "volcengine_ark", True)
        if has_dashscope_key:
            return AudioLlmSelection("dashscope/qwen-flash", "dashscope", True)
        return AudioLlmSelection("", "", False, "没有可用的音频总结模型，请先配置豆包 Endpoint 或 DashScope")

    if requested.startswith("ep-"):
        return AudioLlmSelection(
            "",
            "",
            False,
            "裸 Endpoint ID 缺少供应商绑定，请选择“豆包 Endpoint（跟随默认配置）”",
        )

    if requested.startswith("dashscope/") or requested.startswith("qwen"):
        if not has_dashscope_key:
            return AudioLlmSelection("", "dashscope", False, "该模型缺少 DashScope API Key")
        return AudioLlmSelection(requested, "dashscope", True)

    return AudioLlmSelection(
        "",
        "",
        False,
        "当前音频工作坊不认识这个模型配置，请在模型设置中绑定供应商后再试",
    )


def require_audio_llm_selection(*args, **kwargs) -> AudioLlmSelection:
    selection = resolve_audio_llm_selection(*args, **kwargs)
    if not selection.available:
        raise ValueError(selection.reason or "音频总结模型不可用")
    return selection
