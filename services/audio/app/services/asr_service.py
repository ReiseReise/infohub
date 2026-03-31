"""ASR 语音转写服务 — 通义听悟 + Paraformer 适配器"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional
from app.config import settings


@dataclass
class Segment:
    start: float      # 开始时间（秒）
    end: float        # 结束时间（秒）
    text: str
    speaker: str | None = None


@dataclass
class TranscriptionResult:
    text: str                          # 纯文本
    segments: list[Segment] = field(default_factory=list)
    speakers: list[str] = field(default_factory=list)
    language: str = "zh"
    duration: float = 0.0
    raw_response: dict = field(default_factory=dict)


class ASRProvider(ABC):
    """ASR 服务抽象接口"""

    @abstractmethod
    async def transcribe(
        self,
        audio_url: str,
        language: str = "auto",
        speaker_diarization: bool = True,
        speaker_count: int = 0,
    ) -> TranscriptionResult:
        pass


class TingwuASR(ASRProvider):
    """通义听悟 ASR — 0.6 元/小时，含说话人分离+AI能力"""

    def __init__(self, access_key_id: str = "", access_key_secret: str = "", app_key: str = ""):
        self.access_key_id = access_key_id or settings.tingwu_access_key_id
        self.access_key_secret = access_key_secret or settings.tingwu_access_key_secret
        self.app_key = app_key or settings.tingwu_app_key
        self.region = settings.tingwu_region

    async def transcribe(
        self,
        audio_url: str,
        language: str = "auto",
        speaker_diarization: bool = True,
        speaker_count: int = 0,
    ) -> TranscriptionResult:
        from alibabacloud_tingwu20230930.client import Client
        from alibabacloud_tingwu20230930 import models as tingwu_models
        from alibabacloud_tea_openapi import models as open_api_models

        config = open_api_models.Config(
            access_key_id=self.access_key_id,
            access_key_secret=self.access_key_secret,
            region_id=self.region,
        )
        client = Client(config)

        # 构建请求
        input_param = tingwu_models.CreateTaskRequestInput(
            source_language=language if language != "auto" else "cn",
            file_url=audio_url,
        )
        parameters = tingwu_models.CreateTaskRequestParameters(
            transcription=tingwu_models.CreateTaskRequestParametersTranscription(
                diarization_enabled=speaker_diarization,
                diarization=tingwu_models.CreateTaskRequestParametersTranscriptionDiarization(
                    speaker_count=speaker_count,
                ) if speaker_diarization else None,
            ),
        )
        request = tingwu_models.CreateTaskRequest(
            input=input_param,
            parameters=parameters,
        )

        # 创建任务
        response = client.create_task(request)
        task_id = response.body.data.task_id

        # 轮询等待结果
        import asyncio
        for _ in range(120):  # 最多等 20 分钟
            await asyncio.sleep(10)
            query_request = tingwu_models.GetTaskInfoRequest(task_id=task_id)
            result = client.get_task_info(query_request)
            status = result.body.data.task_status
            if status == "COMPLETED":
                return self._parse_result(result.body.data)
            elif status == "FAILED":
                raise RuntimeError(f"听悟转写失败: {result.body.data}")

        raise TimeoutError("听悟转写超时（20分钟）")

    def _parse_result(self, data) -> TranscriptionResult:
        """解析通义听悟返回结果为统一格式"""
        # 通义听悟的结果格式需要根据实际 API 响应调整
        segments = []
        speakers = set()
        full_text = ""

        if hasattr(data, "result") and data.result:
            result = data.result
            if isinstance(result, dict):
                transcription = result.get("transcription", {})
                paragraphs = transcription.get("paragraphs", [])
                for para in paragraphs:
                    speaker = para.get("speaker_id", "")
                    words = para.get("words", [])
                    text = "".join([w.get("text", "") for w in words])
                    start = para.get("start", 0) / 1000.0  # ms → s
                    end = para.get("end", 0) / 1000.0
                    segments.append(Segment(start=start, end=end, text=text, speaker=speaker))
                    if speaker:
                        speakers.add(speaker)
                    full_text += text + "\n"

        return TranscriptionResult(
            text=full_text.strip(),
            segments=segments,
            speakers=sorted(speakers),
            raw_response=data if isinstance(data, dict) else {},
        )


class ParaformerASR(ASRProvider):
    """Paraformer ASR（百炼 DashScope）— 0.288 元/小时
    
    本地文件 → Recognition 实时流式 API（WebSocket 传输，无需上传）
    HTTP/OSS URL → Transcription 批量 API
    """

    def __init__(self, api_key: str = ""):
        self.api_key = (api_key or settings.dashscope_api_key).strip()

    def _is_local_file(self, audio_url: str) -> str | None:
        """判断是否为本地文件，返回绝对路径或 None"""
        from pathlib import Path
        if audio_url.startswith(("http://", "https://", "oss://")):
            return None
        local_path = Path(audio_url)
        if local_path.exists():
            return str(local_path.resolve())
        return None

    async def transcribe(
        self,
        audio_url: str,
        language: str = "auto",
        speaker_diarization: bool = True,
        speaker_count: int = 0,
    ) -> TranscriptionResult:
        import dashscope
        dashscope.api_key = self.api_key

        local_path = self._is_local_file(audio_url)
        if local_path:
            return await self._transcribe_local(local_path, speaker_diarization)
        else:
            return await self._transcribe_remote(audio_url, language)

    def transcribe_local_sync(
        self,
        file_path: str,
        speaker_diarization: bool = True,
        expected_duration: float | None = None,
        chunk_seconds: int | None = None,
    ) -> TranscriptionResult:
        """本地文件同步转写：直接调用 Recognition 实时 API
        
        ⚠️ Celery 必须用 --pool=solo（无 fork），否则 WebSocket 线程死锁。
        音频统一预转为 WAV 16kHz 单声道（Recognition 对 MP3 等格式不稳定）。
        """
        # 预转为 WAV 16kHz（Recognition 对 MP3 格式不稳定会挂起）
        wav_path = None
        actual_path = file_path
        fmt, sr, duration = self._probe_audio_details(file_path)
        if fmt != "wav" or sr != 16000:
            import subprocess
            import tempfile

            wav_path = tempfile.mktemp(suffix=".wav")
            subprocess.run(
                ["ffmpeg", "-i", file_path, "-ar", "16000", "-ac", "1", "-y", wav_path],
                capture_output=True, timeout=60,
            )
            actual_path = wav_path
            fmt, sr, _ = "wav", 16000, 0.0

        try:
            _, _, probed_duration = self._probe_audio_details(actual_path)
            duration = probed_duration or duration or float(expected_duration or 0)
            if duration > 900:
                return self._transcribe_local_chunked(
                    actual_path,
                    speaker_diarization=speaker_diarization,
                    chunk_seconds=chunk_seconds or self._chunk_seconds_for_duration(duration),
                )
            return self._transcribe_single_local_sync(actual_path, fmt=fmt, sr=sr, speaker_diarization=speaker_diarization, timeout_seconds=self._timeout_for_duration(duration))
        finally:
            import os
            if wav_path and os.path.exists(wav_path):
                os.unlink(wav_path)

    def _transcribe_single_local_sync(
        self,
        file_path: str,
        fmt: str,
        sr: int,
        speaker_diarization: bool = True,
        timeout_seconds: int = 600,
    ) -> TranscriptionResult:
        import dashscope
        import threading
        from dashscope.audio.asr import Recognition, RecognitionCallback

        dashscope.api_key = self.api_key

        class _Callback(RecognitionCallback):
            def __init__(self):
                self.done = threading.Event()
            def on_complete(self):
                self.done.set()
            def on_error(self, result):
                self.done.set()
            def on_event(self, result):
                pass

        cb = _Callback()
        rec = Recognition(
            model="paraformer-realtime-v2",
            callback=cb,
            format=fmt,
            sample_rate=sr,
            diarization_enabled=speaker_diarization,
        )
        result = rec.call(file_path)
        if not cb.done.wait(timeout=timeout_seconds):
            raise TimeoutError(f"Paraformer 实时转写超时: {timeout_seconds}s")
        if result.status_code != 200:
            raise RuntimeError(f"Paraformer 实时转写失败: code={result.status_code} msg={result.message}")
        parsed = self._parse_realtime_result(result)
        _, _, duration = self._probe_audio_details(file_path)
        parsed.duration = duration
        return parsed

    def _transcribe_local_chunked(
        self,
        file_path: str,
        speaker_diarization: bool = True,
        chunk_seconds: int = 900,
    ) -> TranscriptionResult:
        import os
        import subprocess
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory(prefix="paraformer-chunks-") as temp_dir:
            pattern = str(Path(temp_dir) / "chunk-%03d.wav")
            subprocess.run(
                [
                    "ffmpeg",
                    "-i",
                    file_path,
                    "-f",
                    "segment",
                    "-segment_time",
                    str(chunk_seconds),
                    "-c",
                    "copy",
                    "-reset_timestamps",
                    "1",
                    "-y",
                    pattern,
                ],
                capture_output=True,
                timeout=180,
            )
            chunk_paths = sorted(str(Path(temp_dir) / name) for name in os.listdir(temp_dir) if name.endswith(".wav"))
            if not chunk_paths:
                return self._transcribe_single_local_sync(
                    file_path,
                    fmt="wav",
                    sr=16000,
                    speaker_diarization=speaker_diarization,
                    timeout_seconds=self._timeout_for_duration(chunk_seconds),
                )

            merged_segments: list[Segment] = []
            merged_text_parts: list[str] = []
            merged_speakers: set[str] = set()
            offset = 0.0

            for chunk_path in chunk_paths:
                chunk_result = self._transcribe_single_local_sync(
                    chunk_path,
                    fmt="wav",
                    sr=16000,
                    speaker_diarization=speaker_diarization,
                    timeout_seconds=self._timeout_for_duration(chunk_seconds),
                )
                for seg in chunk_result.segments:
                    merged_segments.append(
                        Segment(
                            start=seg.start + offset,
                            end=seg.end + offset,
                            text=seg.text,
                            speaker=seg.speaker,
                        )
                    )
                if chunk_result.text.strip():
                    merged_text_parts.append(chunk_result.text.strip())
                for speaker in chunk_result.speakers:
                    merged_speakers.add(speaker)
                _, _, chunk_duration = self._probe_audio_details(chunk_path)
                offset += chunk_duration or float(chunk_seconds)

            return TranscriptionResult(
                text="\n".join(merged_text_parts).strip(),
                segments=merged_segments,
                speakers=sorted(merged_speakers),
                duration=offset,
            )

    @staticmethod
    def _timeout_for_duration(duration: float) -> int:
        safe_duration = max(duration, 30)
        return max(120, min(1800, int(safe_duration * 1.5) + 90))

    @staticmethod
    def _chunk_seconds_for_duration(duration: float) -> int:
        if duration >= 3600:
            return 180
        if duration >= 1800:
            return 240
        if duration >= 900:
            return 300
        return 600

    async def _transcribe_local(
        self, file_path: str, speaker_diarization: bool = True
    ) -> TranscriptionResult:
        """async 包装（仅用于非 Celery 场景，如直接 FastAPI 调用）"""
        import asyncio
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self.transcribe_local_sync, file_path, speaker_diarization
        )

    async def _transcribe_remote(self, file_url: str, language: str = "auto") -> TranscriptionResult:
        """远程 URL：用 Transcription 批量 API"""
        from dashscope.audio.asr import Transcription

        task_response = Transcription.async_call(
            model="paraformer-v2",
            file_urls=[file_url],
            language_hints=["zh", "en"] if language == "auto" else [language],
            diarization_enabled=True,
        )
        result = Transcription.wait(task_response.output.task_id)

        if result.output.task_status == "SUCCEEDED":
            return self._parse_batch_result(result.output)
        elif result.output.task_status == "FAILED":
            # DECODE_ERROR 通常是音频无语音内容，返回空转写
            results = getattr(result.output, "results", []) or []
            codes = [r.get("code", "") for r in results if isinstance(r, dict)]
            if all(c == "DECODE_ERROR" for c in codes):
                return TranscriptionResult(text="", segments=[], speakers=[])
            raise RuntimeError(f"Paraformer 转写失败: {result.output}")
        else:
            raise RuntimeError(f"Paraformer 转写异常状态: {result.output}")

    @staticmethod
    def _probe_audio(file_path: str) -> tuple[str, int]:
        """探测音频格式和采样率，返回 (format, sample_rate)"""
        fmt, sr, _ = ParaformerASR._probe_audio_details(file_path)
        return fmt, sr

    @staticmethod
    def _probe_audio_details(file_path: str) -> tuple[str, int, float]:
        """探测音频格式、采样率、时长，返回 (format, sample_rate, duration_seconds)"""
        import subprocess, json
        try:
            out = subprocess.run(
                ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file_path],
                capture_output=True, text=True, timeout=10,
            )
            info = json.loads(out.stdout)
            stream = next((s for s in info.get("streams", []) if s["codec_type"] == "audio"), None)
            duration = float((stream or {}).get("duration") or info.get("format", {}).get("duration") or 0)
            if stream:
                sr = int(stream.get("sample_rate", 16000))
                codec = stream.get("codec_name", "")
                fmt_map = {"mp3": "mp3", "aac": "aac", "pcm_s16le": "pcm", "flac": "flac",
                           "opus": "opus", "vorbis": "ogg"}
                fmt = fmt_map.get(codec, "wav")
                return fmt, sr, duration
        except Exception:
            pass
        # 默认 WAV 16kHz
        return "wav", 16000, 0.0

    def _parse_realtime_result(self, result) -> TranscriptionResult:
        """解析 Recognition 实时 API 结果"""
        sentences_data = result.get_sentence() or []
        segments = []
        full_text = ""

        for s in sentences_data:
            text = s.get("text", "")
            begin_time = s.get("begin_time", 0) / 1000.0
            end_time = s.get("end_time", 0) / 1000.0
            speaker = s.get("speaker_id", None)
            segments.append(Segment(start=begin_time, end=end_time, text=text, speaker=speaker))
            full_text += text

        speakers = sorted(set(seg.speaker for seg in segments if seg.speaker))
        return TranscriptionResult(text=full_text, segments=segments, speakers=speakers)

    def _parse_batch_result(self, output) -> TranscriptionResult:
        """解析 Transcription 批量 API 结果"""
        import httpx
        segments = []
        full_text = ""

        if hasattr(output, "results") and output.results:
            for file_result in output.results:
                transcription_url = file_result.get("transcription_url", "")
                if transcription_url:
                    resp = httpx.get(transcription_url)
                    if resp.status_code == 200:
                        data = resp.json()
                        transcripts = data.get("transcripts", [])
                        for t in transcripts:
                            text = t.get("text", "")
                            sentences = t.get("sentences", [])
                            for s in sentences:
                                seg_text = s.get("text", "")
                                begin_time = s.get("begin_time", 0) / 1000.0
                                end_time = s.get("end_time", 0) / 1000.0
                                speaker = s.get("speaker_id")
                                if speaker is not None:
                                    speaker = str(speaker)
                                segments.append(Segment(start=begin_time, end=end_time, text=seg_text, speaker=speaker))
                            full_text += text + "\n"

        speakers = sorted(set(seg.speaker for seg in segments if seg.speaker))
        return TranscriptionResult(
            text=full_text.strip(),
            segments=segments,
            speakers=speakers,
        )


def get_asr_provider(provider: str = "auto", **kwargs) -> ASRProvider:
    """获取 ASR 服务。provider='auto' 时自动选择有凭证的服务。"""
    providers = {
        "tingwu": TingwuASR,
        "paraformer": ParaformerASR,
    }

    if provider == "auto":
        if has_tingwu_credentials():
            provider = "tingwu"
        elif has_paraformer_credentials():
            provider = "paraformer"
        else:
            raise ValueError("未配置任何 ASR 凭证。请在 .env 中设置 TINGWU 或 DASHSCOPE 凭证。")

    cls = providers.get(provider)
    if not cls:
        raise ValueError(f"未知 ASR 提供商: {provider}。可选: {list(providers.keys())}")
    return cls(**kwargs)


def has_tingwu_credentials() -> bool:
    return bool(
        settings.tingwu_access_key_id.strip()
        and settings.tingwu_access_key_secret.strip()
        and settings.tingwu_app_key.strip()
    )


def has_paraformer_credentials() -> bool:
    return bool(settings.dashscope_api_key.strip())


def can_use_remote_asr(audio_url: str) -> bool:
    return audio_url.startswith(("http://", "https://", "oss://"))
