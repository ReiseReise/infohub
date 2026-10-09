"""Safe error details for internal LLM clients; never include provider response bodies."""

from __future__ import annotations


class LLMUpstreamError(RuntimeError):
    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"LLM upstream HTTP {status_code}")


def llm_error_response(error: Exception) -> tuple[int, dict] | None:
    names = {cls.__name__ for cls in type(error).__mro__}
    status = getattr(error, "status_code", None)
    if names & {"TimeoutException", "TimeoutError", "APITimeoutError"}:
        return 504, {"code": "upstream_timeout", "message": "模型响应超时，请稍后重试。", "retryable": True}
    if names & {"TransportError", "APIConnectionError", "ConnectionError"}:
        return 503, {"code": "upstream_connection_error", "message": "模型服务连接中断，请稍后重试。", "retryable": True}
    if isinstance(status, int) and status >= 400:
        retryable = status in {408, 429} or status >= 500
        code = "upstream_rate_limited" if status == 429 else "upstream_unavailable" if retryable else "upstream_request_rejected"
        message = "模型服务暂时不可用，请稍后重试。" if retryable else "模型服务拒绝请求，请检查模型配置与权限。"
        return (429 if status == 429 else 503 if retryable else 422), {
            "code": code, "message": message, "retryable": retryable, "providerStatus": status,
        }
    return None
