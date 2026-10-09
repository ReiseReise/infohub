"""模型连接配置的同步判定。

只比较会影响真实 Provider 调用的字段，避免服务重启或别名变更把已验证的
模型误标为“未测试”。
"""

from __future__ import annotations

from hmac import compare_digest
from typing import Any


def _normalized_text(value: str | None) -> str:
    return (value or "").strip()


def _normalized_provider(value: str | None) -> str:
    return _normalized_text(value).lower()


def _normalized_base_url(value: str | None) -> str:
    return _normalized_text(value).rstrip("/")


def model_connection_settings_changed(
    *,
    current_provider: str | None,
    current_model_name: str | None,
    current_api_key: str | None,
    current_base_url: str | None,
    current_extra_config: dict[str, Any] | None,
    next_provider: str | None,
    next_model_name: str | None,
    next_api_key: str | None,
    next_base_url: str | None,
    next_extra_config: dict[str, Any] | None,
) -> bool:
    """返回 Provider 连接参数是否真实变化，不记录或返回密钥内容。"""

    if _normalized_provider(current_provider) != _normalized_provider(next_provider):
        return True
    if _normalized_text(current_model_name) != _normalized_text(next_model_name):
        return True
    if not compare_digest(
        _normalized_text(current_api_key),
        _normalized_text(next_api_key),
    ):
        return True
    if _normalized_base_url(current_base_url) != _normalized_base_url(next_base_url):
        return True
    return (current_extra_config or {}) != (next_extra_config or {})
