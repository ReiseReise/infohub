"""LLM 服务 — 统一多模型路由，Ark 走 Responses API。"""

from dataclasses import dataclass
import time
from typing import Any

import httpx

from app.config import settings
from app.services.llm_errors import LLMUpstreamError


@dataclass
class LLMResult:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    model: str = ""
    provider: str = ""
    endpoint_id: str | None = None
    estimated_cost: float | None = None
    provider_request_id: str | None = None
    latency_ms: int | None = None
    api_kind: str = "chat.completions"


class LLMService:
    """统一 LLM 调用，支持 Qwen/Claude/GPT/Gemini 等"""

    @staticmethod
    def _resolve_target(
        model: str,
        provider: str = "",
        base_url: str | None = None,
        extra_config: dict | None = None,
    ) -> dict[str, Any]:
        normalized_model = (model or "").strip()
        normalized_provider = (provider or "").strip().lower()
        normalized_base_url = (base_url or "").strip() or None
        normalized_extra = extra_config or {}

        access_mode = str(normalized_extra.get("accessMode") or "").strip().lower()
        endpoint_id = str(normalized_extra.get("endpointId") or normalized_model).strip()

        is_volcengine_ark = normalized_provider in {"volcengine_ark", "doubao"} or (
            normalized_base_url is not None and "volces.com" in normalized_base_url
        )
        if not is_volcengine_ark and "doubao" in normalized_model.lower():
            is_volcengine_ark = True
        if is_volcengine_ark:
            if not normalized_base_url:
                normalized_base_url = settings.ark_base_url
            if access_mode == "endpoint" or endpoint_id.startswith("ep-"):
                return {
                    "provider": "volcengine_ark",
                    "base_url": normalized_base_url,
                    "model": endpoint_id,
                    "endpoint_id": endpoint_id,
                    "api_kind": "responses",
                }
            if normalized_model and "/" not in normalized_model:
                normalized_model = f"openai/{normalized_model}"
            return {
                "provider": normalized_provider or "volcengine_ark",
                "base_url": normalized_base_url,
                "model": normalized_model,
                "endpoint_id": None,
                "api_kind": "chat.completions",
            }

        is_openai_compatible = normalized_provider in {"openai_compatible", "openai-compatible", "custom_openai"}
        if is_openai_compatible and normalized_model and "/" not in normalized_model:
            normalized_model = f"openai/{normalized_model}"
        if normalized_provider == "deepseek":
            normalized_base_url = normalized_base_url or "https://api.deepseek.com"
            if normalized_model and "/" not in normalized_model:
                normalized_model = f"openai/{normalized_model}"

        return {
            "provider": normalized_provider,
            "base_url": normalized_base_url,
            "model": normalized_model,
            "endpoint_id": None,
            "api_kind": "chat.completions",
        }

    @staticmethod
    def _preview(text: str, limit: int = 400) -> str:
        normalized = " ".join((text or "").split())
        if len(normalized) <= limit:
            return normalized
        return normalized[: limit - 1].rstrip() + "…"

    async def _complete_with_ark_responses(
        self,
        *,
        endpoint_id: str,
        prompt: str,
        api_key: str,
        base_url: str | None,
        temperature: float,
        max_tokens: int,
        thinking: dict | None = None,
    ) -> LLMResult:
        if not endpoint_id.startswith("ep-"):
            raise ValueError("Volcengine Ark requires a valid endpoint id like ep-xxxxxxxx")
        if not api_key:
            raise ValueError("ARK_API_KEY is missing for Volcengine Ark endpoint calls")

        started_at = time.perf_counter()
        url = f"{(base_url or settings.ark_base_url).rstrip('/')}/responses"
        payload = {
            "model": endpoint_id,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt},
                    ],
                }
            ],
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }
        if thinking:
            payload["thinking"] = thinking
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0)) as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        if response.status_code >= 400:
            raise LLMUpstreamError(response.status_code)

        data = response.json()
        text_parts: list[str] = []
        for item in data.get("output", []) or []:
            if item.get("type") != "message":
                continue
            for content in item.get("content", []) or []:
                if content.get("type") == "output_text":
                    text_parts.append(content.get("text", ""))
        usage = data.get("usage") or {}
        input_tokens = int(usage.get("input_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or 0)
        total_tokens = int(usage.get("total_tokens") or (input_tokens + output_tokens))
        return LLMResult(
            text="\n".join(part for part in text_parts if part).strip(),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            model=endpoint_id,
            provider="volcengine_ark",
            endpoint_id=endpoint_id,
            estimated_cost=None,
            provider_request_id=response.headers.get("x-request-id") or data.get("id"),
            latency_ms=latency_ms,
            api_kind="responses",
        )

    async def complete(
        self,
        model: str,
        prompt: str,
        api_key: str = "",
        base_url: str | None = None,
        provider: str = "",
        extra_config: dict | None = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        response_format: dict | None = None,
        thinking: dict | None = None,
    ) -> LLMResult:
        target = self._resolve_target(
            model=model,
            provider=provider,
            base_url=base_url,
            extra_config=extra_config,
        )

        # 根据 model 前缀自动匹配 api_key
        if not api_key:
            api_key = self._resolve_api_key(target["model"], provider=target["provider"])

        if target["api_kind"] == "responses":
            return await self._complete_with_ark_responses(
                endpoint_id=target["endpoint_id"],
                prompt=prompt,
                api_key=api_key,
                base_url=target["base_url"],
                temperature=temperature,
                max_tokens=max_tokens,
                thinking=thinking,
            )

        import litellm

        started_at = time.perf_counter()
        completion_kwargs: dict[str, Any] = {
            "model": target["model"],
            "messages": [{"role": "user", "content": prompt}],
            "api_key": api_key,
            "api_base": target["base_url"],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "timeout": 90,
            "num_retries": 0,
        }
        if response_format:
            completion_kwargs["response_format"] = response_format
        if thinking:
            completion_kwargs["extra_body"] = {"thinking": thinking}
        response = await litellm.acompletion(**completion_kwargs)
        latency_ms = int((time.perf_counter() - started_at) * 1000)

        estimated_cost = None
        try:
            estimated_cost = float(litellm.completion_cost(completion_response=response))
        except Exception:
            estimated_cost = None

        return LLMResult(
            text=response.choices[0].message.content,
            input_tokens=response.usage.prompt_tokens if response.usage else 0,
            output_tokens=response.usage.completion_tokens if response.usage else 0,
            total_tokens=(response.usage.total_tokens if response.usage and getattr(response.usage, "total_tokens", None) is not None else ((response.usage.prompt_tokens if response.usage else 0) + (response.usage.completion_tokens if response.usage else 0))),
            model=target["model"],
            provider=target["provider"] or provider,
            endpoint_id=target["endpoint_id"],
            estimated_cost=estimated_cost,
            provider_request_id=getattr(response, "id", None),
            latency_ms=latency_ms,
            api_kind=target["api_kind"],
        )

    async def summarize_long_text(
        self,
        transcript: str,
        rendered_prompt: str,
        model: str,
        api_key: str = "",
        base_url: str | None = None,
        provider: str = "",
        extra_config: dict | None = None,
        max_chunk_tokens: int = 100000,
    ) -> LLMResult:
        """
        长文本分段总结策略：
        1. 如果 rendered_prompt（含逐字稿）< max_chunk_tokens → 一次性处理
        2. 如果超过 → 分段总结 + 最终合并
        """
        estimated_tokens = len(rendered_prompt) * 1.5  # 粗估 1 中文字 ≈ 1.5 token

        if estimated_tokens <= max_chunk_tokens:
            result = await self.complete(
                model=model,
                prompt=rendered_prompt,
                api_key=api_key,
                base_url=base_url,
                provider=provider,
                extra_config=extra_config,
                max_tokens=8192,
            )
            return await self._ensure_simplified_chinese(
                result,
                model=model,
                api_key=api_key,
                base_url=base_url,
                provider=provider,
                extra_config=extra_config,
            )

        # 分段策略
        chunk_size = int(max_chunk_tokens / 1.5)  # 每段最大字符数
        chunks = self._split_text(transcript, chunk_size)
        partial_summaries = []

        for i, chunk in enumerate(chunks):
            chunk_prompt = (
                "始终使用简体中文输出；原文金句和专有名词可保留原语言，"
                "但需附中文解释。\n"
                f"这是一段长音频逐字稿的第 {i+1}/{len(chunks)} 部分。"
                f"请用简体中文提取这一部分的关键内容：\n\n{chunk}"
            )
            result = await self.complete(
                model=model,
                prompt=chunk_prompt,
                api_key=api_key,
                base_url=base_url,
                provider=provider,
                extra_config=extra_config,
                max_tokens=4096,
            )
            partial_summaries.append(result.text)

        # 合并总结
        merge_prompt = (
            "始终使用简体中文输出，保留 Markdown 标题、列表、时间戳和证据层级。"
            "原文金句和专有名词可保留原语言，但需附中文解释。\n"
            "以下是一段长音频的分段摘要。请将它们合并为一份完整的结构化中文总结：\n\n"
            + "\n\n---\n\n".join(
                [f"### 第 {i+1} 部分\n{s}" for i, s in enumerate(partial_summaries)]
            )
        )
        final_result = await self.complete(
            model=model,
            prompt=merge_prompt,
            api_key=api_key,
            base_url=base_url,
            provider=provider,
            extra_config=extra_config,
            max_tokens=8192,
        )

        total_input = sum(len(s) for s in partial_summaries)
        combined_result = LLMResult(
            text=final_result.text,
            input_tokens=final_result.input_tokens + total_input,
            output_tokens=final_result.output_tokens,
            total_tokens=final_result.total_tokens + total_input,
            model=model,
            provider=final_result.provider,
            endpoint_id=final_result.endpoint_id,
            estimated_cost=final_result.estimated_cost,
            provider_request_id=final_result.provider_request_id,
            latency_ms=final_result.latency_ms,
            api_kind=final_result.api_kind,
        )
        return await self._ensure_simplified_chinese(
            combined_result,
            model=model,
            api_key=api_key,
            base_url=base_url,
            provider=provider,
            extra_config=extra_config,
        )

    @staticmethod
    def _needs_chinese_repair(text: str) -> bool:
        """音频纪要主体应为中文；保留少量英文专名不应触发误判。"""
        normalized = (text or "").strip()
        if len(normalized) < 120:
            return False
        chinese_chars = sum(1 for char in normalized if "\u4e00" <= char <= "\u9fff")
        visible_chars = sum(1 for char in normalized if not char.isspace())
        return chinese_chars < 80 or chinese_chars / max(visible_chars, 1) < 0.18

    async def _ensure_simplified_chinese(
        self,
        result: LLMResult,
        *,
        model: str,
        api_key: str,
        base_url: str | None,
        provider: str,
        extra_config: dict | None,
    ) -> LLMResult:
        if not self._needs_chinese_repair(result.text):
            return result

        repair_prompt = (
            "下面的音频纪要错误地使用了英文。请将全文改写为简体中文：\n"
            "- 完整保留 Markdown 标题、列表、时间戳和信息层级；\n"
            "- 专有名词、人名和原文金句可保留原语言，但需附中文解释；\n"
            "- 不得压缩成更短摘要，不得丢失事实、证据和行动项。\n\n"
            f"待修复纪要：\n{result.text}"
        )
        repaired = await self.complete(
            model=model,
            prompt=repair_prompt,
            api_key=api_key,
            base_url=base_url,
            provider=provider,
            extra_config=extra_config,
            max_tokens=8192,
        )
        return LLMResult(
            text=repaired.text,
            input_tokens=result.input_tokens + repaired.input_tokens,
            output_tokens=result.output_tokens + repaired.output_tokens,
            total_tokens=result.total_tokens + repaired.total_tokens,
            model=repaired.model or result.model,
            provider=repaired.provider or result.provider,
            endpoint_id=repaired.endpoint_id or result.endpoint_id,
            estimated_cost=(result.estimated_cost or 0) + (repaired.estimated_cost or 0),
            provider_request_id=repaired.provider_request_id,
            latency_ms=(result.latency_ms or 0) + (repaired.latency_ms or 0),
            api_kind=repaired.api_kind or result.api_kind,
        )

    def _resolve_api_key(self, model: str, provider: str = "") -> str:
        """根据模型名推断使用哪个 API Key"""
        model_lower = model.lower()
        provider_lower = provider.lower()
        if provider_lower in {"volcengine_ark", "doubao"}:
            return settings.ark_api_key
        if "doubao" in model_lower:
            return settings.ark_api_key
        if any(k in model_lower for k in ["qwen", "dashscope", "paraformer", "wanx"]):
            return settings.dashscope_api_key
        if model_lower.startswith("openai/") and "volces.com" in settings.ark_base_url:
            return settings.ark_api_key or settings.openai_api_key
        elif any(k in model_lower for k in ["gpt", "openai"]):
            return settings.openai_api_key
        elif any(k in model_lower for k in ["claude", "anthropic"]):
            return settings.anthropic_api_key
        elif any(k in model_lower for k in ["gemini", "google"]):
            return settings.google_api_key
        return settings.dashscope_api_key  # 默认

    @staticmethod
    def _split_text(text: str, chunk_size: int) -> list[str]:
        """按段落边界分割长文本"""
        paragraphs = text.split("\n")
        chunks = []
        current_chunk = ""

        for para in paragraphs:
            if len(para) > chunk_size:
                if current_chunk.strip():
                    chunks.append(current_chunk.strip())
                    current_chunk = ""
                for offset in range(0, len(para), chunk_size):
                    piece = para[offset : offset + chunk_size].strip()
                    if piece:
                        chunks.append(piece)
                continue
            if len(current_chunk) + len(para) > chunk_size and current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = ""
            current_chunk += para + "\n"

        if current_chunk.strip():
            chunks.append(current_chunk.strip())

        return chunks if chunks else [text]
