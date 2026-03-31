"""音频预处理服务 — 格式转换、信息提取、分片"""

import os
import tempfile
import subprocess
from dataclasses import dataclass


@dataclass
class AudioInfo:
    duration: float        # 秒
    format: str            # mp3, wav, m4a, ...
    sample_rate: int
    channels: int
    file_size: int         # 字节


def get_audio_info(file_path: str) -> AudioInfo:
    """使用 ffprobe 获取音频文件信息"""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format", "-show_streams",
        file_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe 失败: {result.stderr}")

    import json
    info = json.loads(result.stdout)
    fmt = info.get("format", {})
    streams = info.get("streams", [{}])
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), streams[0] if streams else {})

    return AudioInfo(
        duration=float(fmt.get("duration", 0)),
        format=fmt.get("format_name", "").split(",")[0],
        sample_rate=int(audio_stream.get("sample_rate", 0)),
        channels=int(audio_stream.get("channels", 0)),
        file_size=int(fmt.get("size", 0)),
    )


def convert_to_mp3(input_path: str, output_path: str | None = None, bitrate: str = "128k") -> str:
    """将任意音频格式转换为 MP3"""
    if output_path is None:
        output_path = tempfile.mktemp(suffix=".mp3")

    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-codec:a", "libmp3lame", "-b:a", bitrate,
        "-ar", "16000", "-ac", "1",  # 16kHz 单声道（ASR 最优）
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 转换失败: {result.stderr}")

    return output_path


def split_audio(input_path: str, chunk_duration: int = 1800, output_dir: str | None = None) -> list[str]:
    """将长音频按指定秒数分片（默认 30 分钟一片）"""
    if output_dir is None:
        output_dir = tempfile.mkdtemp()

    info = get_audio_info(input_path)
    if info.duration <= chunk_duration:
        return [input_path]  # 不需要分片

    chunks = []
    start = 0
    idx = 0
    while start < info.duration:
        chunk_path = os.path.join(output_dir, f"chunk_{idx:03d}.mp3")
        cmd = [
            "ffmpeg", "-y", "-i", input_path,
            "-ss", str(start), "-t", str(chunk_duration),
            "-codec:a", "libmp3lame", "-b:a", "128k",
            chunk_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"分片失败: {result.stderr}")
        chunks.append(chunk_path)
        start += chunk_duration
        idx += 1

    return chunks
