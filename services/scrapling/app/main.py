import re
import asyncio
from time import perf_counter
from typing import Literal
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from readabilipy import simple_json_from_html_string
from scrapling.fetchers import DynamicFetcher, Fetcher, StealthyFetcher


RenderMode = Literal["auto", "native", "dynamic", "stealth"]

KNOWN_DYNAMIC_DOMAINS = {
    "toutiao.com",
    "www.toutiao.com",
    "jinritoutiao.com",
    "www.jinritoutiao.com",
}


class ExtractRequest(BaseModel):
    url: str
    mode: RenderMode = "auto"
    waitMs: int = Field(default=12000, ge=3000, le=60000)
    networkIdle: bool = True
    sourceHint: str | None = None


class ExtractResponse(BaseModel):
    title: str | None = None
    content: str | None = None
    snippet: str | None = None
    html: str | None = None
    finalUrl: str | None = None
    renderMode: RenderMode
    blocked: bool = False
    blockedReason: str | None = None
    latencyMs: int


app = FastAPI(title="InfoHub Scrapling Service", version="0.1.0")


def _extract_title(html: str) -> str | None:
    match = re.search(r"<title[^>]*>([\s\S]*?)</title>", html, re.I)
    if not match:
        return None
    title = re.sub(r"\s+", " ", match.group(1)).strip()
    return title or None


def _extract_readable_text(html: str) -> str | None:
    try:
        parsed = simple_json_from_html_string(html, use_readability=True)
        text_parts = []
        for node in parsed.get("plain_text", []):
            if isinstance(node, str) and node.strip():
                text_parts.append(node.strip())
        joined = "\n\n".join(text_parts).strip()
        if joined:
            return joined[:50000]
    except Exception:
        pass
    return None


def _to_response(page, render_mode: RenderMode, started_at: float) -> ExtractResponse:
    html = str(page.html_content or "").strip()
    if not html:
        raw_body = page.body
        html = raw_body.decode(errors="ignore") if isinstance(raw_body, bytes) else str(raw_body or "")
        html = html.strip()

    text = _extract_readable_text(html)
    if not text:
        text = str(page.get_all_text(separator="\n", strip=True) or "").strip()[:50000] or None

    title = _extract_title(html)
    snippet = re.sub(r"\s+", " ", text or "").strip()[:220] or None
    blocked = len(text or "") < 80
    blocked_reason = "rendered_content_too_short" if blocked else None
    return ExtractResponse(
        title=title,
        content=text,
        snippet=snippet,
        html=html[:200000] if html else None,
        finalUrl=str(getattr(page, "url", "") or ""),
        renderMode=render_mode,
        blocked=blocked,
        blockedReason=blocked_reason,
        latencyMs=int((perf_counter() - started_at) * 1000),
    )


def _run_fetch(url: str, mode: RenderMode, wait_ms: int, network_idle: bool):
    timeout_ms = max(wait_ms, 3000)
    def _call(fetcher_cls, **kwargs):
        method = getattr(fetcher_cls, "fetch", None) or getattr(fetcher_cls, "get", None)
        if method is None:
            raise RuntimeError(f"{fetcher_cls.__name__} has no fetch/get method")
        return method(url, **kwargs)
    if mode == "native":
        return _call(Fetcher, timeout=timeout_ms)
    if mode == "dynamic":
        return _call(DynamicFetcher, headless=True, network_idle=network_idle)
    return _call(StealthyFetcher, headless=True, network_idle=network_idle, solve_cloudflare=True)


def _resolve_mode(url: str, mode: RenderMode) -> list[RenderMode]:
    if mode != "auto":
        return [mode]
    host = (urlparse(url).hostname or "").lower()
    if host in KNOWN_DYNAMIC_DOMAINS:
        return ["dynamic", "stealth", "native"]
    return ["native", "dynamic", "stealth"]


def _extract(url: str, mode: RenderMode, wait_ms: int, network_idle: bool) -> ExtractResponse:
    started_at = perf_counter()
    last_error: str | None = None
    for candidate in _resolve_mode(url, mode):
        try:
            page = _run_fetch(url, candidate, wait_ms, network_idle)
            result = _to_response(page, candidate, started_at)
            if result.content and len(result.content) >= 80:
                return result
            last_error = result.blockedReason or "content_too_short"
        except Exception as exc:
            last_error = str(exc)
            continue
    raise HTTPException(status_code=502, detail=last_error or "scrapling_fetch_failed")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "scrapling-service"}


@app.post("/extract/article", response_model=ExtractResponse)
async def extract_article(req: ExtractRequest):
    return await asyncio.to_thread(_extract, req.url, req.mode, req.waitMs, req.networkIdle)


@app.post("/extract/snapshot", response_model=ExtractResponse)
async def extract_snapshot(req: ExtractRequest):
    return await asyncio.to_thread(_extract, req.url, req.mode, req.waitMs, req.networkIdle)
