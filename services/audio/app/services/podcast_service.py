"""播客/视频链接音频下载服务

覆盖三类输入：
1) 播客页面链接
2) 直接音频链接
3) YouTube 链接
"""

from __future__ import annotations

import html
import io
import logging
import os
import re
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

ALLOWED_AUDIO_EXTS = {"mp3", "m4a", "wav", "flac", "ogg", "aac", "opus", "webm", "mp4", "m4b"}
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"


@dataclass
class PodcastDownloadResult:
    file_path: str
    title: str
    duration: float | None
    format: str
    file_size: int
    source_kind: str
    resolve_strategy: str
    source_url: str


@dataclass
class AudioProbeResult:
    source_url: str
    source_kind: str
    probe_status: str
    resolve_strategy: str
    resolved_audio_url: str | None = None
    title: str | None = None
    duration: float | None = None
    content_length: int | None = None
    mime_type: str | None = None
    reason: str | None = None


class DownloadError(ValueError):
    """统一下载错误：附带 failure code，便于前端/日志定位。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def __str__(self) -> str:
        return self.message


def _guess_source_kind(url: str) -> str:
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    if host in YOUTUBE_HOSTS:
        return "youtube"

    path = (parsed.path or "").lower()
    if "." in path:
        ext = path.rsplit(".", 1)[-1]
        if ext in ALLOWED_AUDIO_EXTS:
            return "direct_audio"

    return "podcast_page"


def _guess_ext_from_url(url: str) -> str:
    path = (urlparse(url).path or "").lower()
    if "." in path:
        ext = path.rsplit(".", 1)[-1]
        if ext in ALLOWED_AUDIO_EXTS:
            return ext
    return "mp3"


def _safe_title(title: str | None) -> str:
    raw = (title or "").strip()
    if not raw:
        return "未命名音频"
    cleaned = "".join(ch for ch in raw if ch.isalnum() or ch in ("-", "_", " ", ".", "（", "）", "【", "】", "·"))
    cleaned = cleaned.strip().rstrip(". ")
    return cleaned[:80] or "未命名音频"


def _guess_title_from_url(url: str) -> str:
    path = (urlparse(url).path or "").strip("/")
    if not path:
        return "未命名音频"
    return _safe_title(path.rsplit("/", 1)[-1])


def _map_download_error(err: Exception, fallback_code: str = "DOWNLOAD_FAILED") -> DownloadError:
    if isinstance(err, DownloadError):
        return err

    message = str(err).strip() or "未知错误"
    lowered = message.lower()

    if "timed out" in lowered or "timeout" in lowered:
        return DownloadError("DOWNLOAD_TIMEOUT", f"下载超时：{message}")
    if "unsupported" in lowered or "not supported" in lowered:
        return DownloadError("URL_UNSUPPORTED", f"链接暂不支持：{message}")
    if "403" in lowered or "forbidden" in lowered:
        return DownloadError("DOWNLOAD_FORBIDDEN", f"链接被拒绝访问：{message}")
    if "404" in lowered or "not found" in lowered:
        return DownloadError("MEDIA_NOT_FOUND", f"未找到可用音频：{message}")

    return DownloadError(fallback_code, message)


def _extract_audio_url_from_html(html_text: str) -> str | None:
    patterns = [
        r'"enclosure"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"',
        r'<meta[^>]+property="og:audio"[^>]+content="([^"]+)"',
        r'<meta[^>]+name="twitter:player:stream"[^>]+content="([^"]+)"',
        r'<audio[^>]+src="([^"]+)"',
        r'"audioUrl"\s*:\s*"([^"]+)"',
        r'"audio_url"\s*:\s*"([^"]+)"',
        r'"url"\s*:\s*"(https?://[^"]+\.(?:mp3|m4a|wav|flac|ogg|aac|opus|webm|mp4)(?:\?[^"]*)?)"',
        r'(https?://[^"\s]+\.(?:mp3|m4a|wav|flac|ogg|aac|opus|webm|mp4)(?:\?[^"\s]*)?)',
    ]

    for pattern in patterns:
        match = re.search(pattern, html_text, re.IGNORECASE)
        if not match:
            continue
        candidate = html.unescape(match.group(1)).strip()
        if candidate.startswith("http://") or candidate.startswith("https://"):
            return candidate
    return None


def _extract_title_from_html(html_text: str) -> str | None:
    title_patterns = [
        r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"',
        r'<meta[^>]+name="twitter:title"[^>]+content="([^"]+)"',
        r"<title>(.*?)</title>",
        r'"title"\s*:\s*"([^"]+)"',
    ]
    for pattern in title_patterns:
        match = re.search(pattern, html_text, re.IGNORECASE | re.DOTALL)
        if not match:
            continue
        raw = html.unescape(match.group(1)).replace("\n", " ").strip()
        if raw:
            return _safe_title(raw)
    return None


def _detect_downloaded_file(tmpdir: str) -> str:
    candidates = [
        file for file in Path(tmpdir).glob("*")
        if file.is_file() and file.suffix.lower().lstrip(".") in ALLOWED_AUDIO_EXTS and file.stat().st_size > 1024
    ]
    if not candidates:
        raw = sorted(Path(tmpdir).glob("*"))
        raise DownloadError("MEDIA_NOT_FOUND", f"下载完成但未找到有效音频文件：{[f.name for f in raw]}")

    candidates.sort(key=lambda file: (file.stat().st_size, file.suffix.lower() == ".mp3"), reverse=True)
    return str(candidates[0])


async def _download_with_ytdlp(url: str, tmpdir: str, source_kind: str) -> PodcastDownloadResult:
    import yt_dlp

    output_template = os.path.join(tmpdir, "%(title)s.%(ext)s")
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "128",
            }
        ],
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 90,
        "retries": 2,
        "extractor_retries": 2,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if info is None:
                raise DownloadError("URL_UNSUPPORTED", "无法解析链接内容")

            file_path = _detect_downloaded_file(tmpdir)
            size = os.path.getsize(file_path)
            ext = file_path.rsplit(".", 1)[-1].lower()
            title = _safe_title(str(info.get("title") or _guess_title_from_url(url)))
            duration = info.get("duration")

            return PodcastDownloadResult(
                file_path=file_path,
                title=title,
                duration=duration,
                format=ext,
                file_size=size,
                source_kind=source_kind,
                resolve_strategy="yt_dlp",
                source_url=url,
            )
    except Exception as err:
        raise _map_download_error(err)


async def _download_direct_audio(
    url: str,
    tmpdir: str,
    source_kind: str,
    title_hint: str | None = None,
    strategy: str = "direct_http",
) -> PodcastDownloadResult:
    filename_title = _safe_title(title_hint or _guess_title_from_url(url))

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(20, read=300)) as client:
            resp = await client.get(url, headers={"User-Agent": UA})
            resp.raise_for_status()

        content_type = (resp.headers.get("content-type") or "").lower()
        ext = _guess_ext_from_url(url)
        if "audio/" in content_type:
            subtype = content_type.split("/", 1)[-1].split(";", 1)[0].strip()
            if subtype:
                ext = subtype.lower()

        if ext not in ALLOWED_AUDIO_EXTS and "audio/" not in content_type:
            raise DownloadError("MEDIA_NOT_FOUND", f"链接不是可下载音频（content-type={content_type or 'unknown'}）")

        if ext not in ALLOWED_AUDIO_EXTS:
            ext = "mp3"

        file_path = os.path.join(tmpdir, f"{filename_title}.{ext}")
        with open(file_path, "wb") as f:
            f.write(resp.content)

        size = os.path.getsize(file_path)
        if size <= 1024:
            raise DownloadError("MEDIA_NOT_FOUND", "下载内容为空或过小，未获取到有效音频")

        return PodcastDownloadResult(
            file_path=file_path,
            title=filename_title,
            duration=None,
            format=ext,
            file_size=size,
            source_kind=source_kind,
            resolve_strategy=strategy,
            source_url=url,
        )
    except httpx.TimeoutException as err:
        raise DownloadError("DOWNLOAD_TIMEOUT", f"下载超时：{err}") from err
    except httpx.HTTPStatusError as err:
        status_code = err.response.status_code
        if status_code == 404:
            raise DownloadError("MEDIA_NOT_FOUND", "链接返回 404，未找到音频资源") from err
        if status_code in {401, 403}:
            raise DownloadError("DOWNLOAD_FORBIDDEN", "音频资源需要授权或被拒绝访问") from err
        raise DownloadError("DOWNLOAD_FAILED", f"下载失败（HTTP {status_code}）") from err
    except Exception as err:
        raise _map_download_error(err)


async def _download_xiaoyuzhou(url: str, tmpdir: str) -> PodcastDownloadResult:
    async with httpx.AsyncClient(follow_redirects=True, timeout=40) as client:
        resp = await client.get(url, headers={"User-Agent": UA})
        resp.raise_for_status()
        html_text = resp.text

    audio_url = _extract_audio_url_from_html(html_text)
    if not audio_url:
        raise DownloadError("MEDIA_NOT_FOUND", "无法从小宇宙页面提取音频链接")

    title = _extract_title_from_html(html_text) or "小宇宙播客"
    result = await _download_direct_audio(
        audio_url,
        tmpdir=tmpdir,
        source_kind="podcast_page",
        title_hint=title,
        strategy="xiaoyuzhou_extract",
    )

    dur_match = re.search(r'"duration"\s*:\s*(\d+)', html_text)
    if dur_match:
        result.duration = float(dur_match.group(1))

    result.source_url = url
    return result


async def _probe_http_resource(url: str) -> tuple[int | None, str | None]:
    async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
        try:
            resp = await client.head(url, headers={"User-Agent": UA})
            if resp.status_code >= 400 or not resp.headers:
                raise httpx.HTTPStatusError("head failed", request=resp.request, response=resp)
        except Exception:
            resp = await client.get(url, headers={"User-Agent": UA, "Range": "bytes=0-2047"})
            resp.raise_for_status()
        content_length = resp.headers.get("content-length")
        mime_type = (resp.headers.get("content-type") or "").split(";", 1)[0].strip().lower() or None
        return (int(content_length) if content_length and content_length.isdigit() else None, mime_type)


async def _fetch_audio_prefix(url: str, max_bytes: int = 65536) -> bytes:
    async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
        async with client.stream("GET", url, headers={"User-Agent": UA, "Range": f"bytes=0-{max_bytes - 1}"}) as resp:
            resp.raise_for_status()
            chunks: list[bytes] = []
            total = 0
            async for chunk in resp.aiter_bytes():
                if not chunk:
                    continue
                remaining = max_bytes - total
                chunks.append(chunk[:remaining])
                total += min(len(chunk), remaining)
                if total >= max_bytes:
                    break
            return b"".join(chunks)


def _is_wav_resource(url: str, mime_type: str | None) -> bool:
    path_ext = (urlparse(url).path or "").lower().rsplit(".", 1)[-1]
    return path_ext == "wav" or mime_type in {"audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"}


def _parse_wav_duration(prefix: bytes) -> float | None:
    try:
        with wave.open(io.BytesIO(prefix), "rb") as wf:
            frame_rate = wf.getframerate()
            frames = wf.getnframes()
            if frame_rate > 0 and frames > 0:
                return frames / float(frame_rate)
    except Exception:
        return None
    return None


async def _probe_youtube(url: str) -> AudioProbeResult:
    import yt_dlp

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 30,
        "extractor_retries": 1,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return AudioProbeResult(
        source_url=url,
        source_kind="youtube",
        probe_status="ready",
        resolve_strategy="yt_dlp_probe",
        resolved_audio_url=info.get("url") or url,
        title=_safe_title(str(info.get("title") or _guess_title_from_url(url))),
        duration=float(info.get("duration")) if info.get("duration") else None,
        content_length=int(info.get("filesize") or info.get("filesize_approx") or 0) or None,
        mime_type=str(info.get("acodec") or "").strip() or None,
    )


async def _probe_direct_audio(url: str, source_kind: str) -> AudioProbeResult:
    content_length, mime_type = await _probe_http_resource(url)
    duration = None
    if _is_wav_resource(url, mime_type):
        try:
            duration = _parse_wav_duration(await _fetch_audio_prefix(url))
        except Exception as err:
            logger.debug("wav 时长探测失败: %s | %s", url, err)
    return AudioProbeResult(
        source_url=url,
        source_kind=source_kind,
        probe_status="ready",
        resolve_strategy="direct_http_probe",
        resolved_audio_url=url,
        title=_guess_title_from_url(url),
        duration=duration,
        content_length=content_length,
        mime_type=mime_type,
    )


async def _probe_podcast_page(url: str) -> AudioProbeResult:
    async with httpx.AsyncClient(follow_redirects=True, timeout=40) as client:
        resp = await client.get(url, headers={"User-Agent": UA})
        resp.raise_for_status()
        html_text = resp.text

    audio_url = _extract_audio_url_from_html(html_text)
    if not audio_url:
        raise DownloadError("MEDIA_NOT_FOUND", "页面中未找到可用音频链接")

    duration = None
    dur_match = re.search(r'"duration"\s*:\s*(\d+)', html_text)
    if dur_match:
        duration = float(dur_match.group(1))

    content_length, mime_type = await _probe_http_resource(audio_url)
    return AudioProbeResult(
        source_url=url,
        source_kind="podcast_page",
        probe_status="ready",
        resolve_strategy="page_extract_probe",
        resolved_audio_url=audio_url,
        title=_extract_title_from_html(html_text) or _guess_title_from_url(url),
        duration=duration,
        content_length=content_length,
        mime_type=mime_type,
    )


async def _download_from_podcast_page(url: str, tmpdir: str) -> PodcastDownloadResult:
    host = (urlparse(url).netloc or "").lower()
    if "xiaoyuzhoufm.com" in host:
        return await _download_xiaoyuzhou(url, tmpdir)

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=40) as client:
            resp = await client.get(url, headers={"User-Agent": UA})
            resp.raise_for_status()
            html_text = resp.text
    except httpx.TimeoutException as err:
        raise DownloadError("DOWNLOAD_TIMEOUT", f"页面解析超时：{err}") from err
    except httpx.HTTPStatusError as err:
        status_code = err.response.status_code
        raise DownloadError("DOWNLOAD_FAILED", f"页面访问失败（HTTP {status_code}）") from err

    audio_url = _extract_audio_url_from_html(html_text)
    if not audio_url:
        raise DownloadError("MEDIA_NOT_FOUND", "页面中未找到可用音频链接")

    title = _extract_title_from_html(html_text) or _guess_title_from_url(url)
    result = await _download_direct_audio(
        audio_url,
        tmpdir=tmpdir,
        source_kind="podcast_page",
        title_hint=title,
        strategy="page_extract",
    )
    result.source_url = url
    return result


async def download_audio_from_url(url: str) -> PodcastDownloadResult:
    """从 URL 下载音频，并返回统一元数据。"""
    normalized = (url or "").strip()
    if not normalized:
        raise DownloadError("URL_INVALID", "链接为空")
    if not (normalized.startswith("http://") or normalized.startswith("https://")):
        raise DownloadError("URL_INVALID", "仅支持 http/https 链接")

    source_kind = _guess_source_kind(normalized)
    tmpdir = tempfile.mkdtemp(prefix="podcast_")
    errors: list[DownloadError] = []

    # 按来源类型设定优先策略
    if source_kind == "youtube":
        strategies = [("yt_dlp", _download_with_ytdlp)]
    elif source_kind == "direct_audio":
        strategies = [("direct_http", _download_direct_audio), ("yt_dlp", _download_with_ytdlp)]
    else:
        strategies = [("page_extract", _download_from_podcast_page), ("yt_dlp", _download_with_ytdlp)]

    for strategy_name, strategy in strategies:
        try:
            if strategy_name == "direct_http":
                return await strategy(normalized, tmpdir=tmpdir, source_kind=source_kind)
            if strategy_name == "yt_dlp":
                return await strategy(normalized, tmpdir=tmpdir, source_kind=source_kind)
            return await strategy(normalized, tmpdir=tmpdir)
        except Exception as err:
            mapped = _map_download_error(err)
            errors.append(mapped)
            logger.warning("下载策略失败(%s): %s | %s", strategy_name, normalized, mapped)

    import shutil

    shutil.rmtree(tmpdir, ignore_errors=True)
    if not errors:
        raise DownloadError("DOWNLOAD_FAILED", "下载失败：未知错误")

    # 优先输出更明确的错误类型
    priority = ["MEDIA_NOT_FOUND", "DOWNLOAD_TIMEOUT", "DOWNLOAD_FORBIDDEN", "URL_UNSUPPORTED", "DOWNLOAD_FAILED"]
    for code in priority:
        for err in errors:
            if err.code == code:
                raise err
    raise errors[-1]


async def probe_audio_from_url(url: str) -> AudioProbeResult:
    normalized = (url or "").strip()
    if not normalized:
        raise DownloadError("URL_INVALID", "链接为空")
    if not (normalized.startswith("http://") or normalized.startswith("https://")):
        raise DownloadError("URL_INVALID", "仅支持 http/https 链接")

    source_kind = _guess_source_kind(normalized)
    try:
        if source_kind == "youtube":
            return await _probe_youtube(normalized)
        if source_kind == "direct_audio":
            return await _probe_direct_audio(normalized, source_kind)
        return await _probe_podcast_page(normalized)
    except Exception as err:
        mapped = _map_download_error(err, "PROBE_FAILED")
        return AudioProbeResult(
            source_url=normalized,
            source_kind=source_kind,
            probe_status="failed",
            resolve_strategy="probe_failed",
            reason=mapped.message,
        )
