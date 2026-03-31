"""ASR 子进程 worker — 在独立进程中运行 DashScope Recognition API
避免 Celery prefork 后 WebSocket 线程死锁。

用法: python -m app.services._asr_worker <api_key> <file_path> <output_json>
"""

import sys
import json
import threading


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: _asr_worker.py <api_key> <file_path> <output_json>"}))
        sys.exit(1)

    api_key = sys.argv[1]
    file_path = sys.argv[2]
    output_path = sys.argv[3]

    import dashscope
    import subprocess as sp
    import tempfile
    import os
    from dashscope.audio.asr import Recognition, RecognitionCallback

    dashscope.api_key = api_key

    class _Callback(RecognitionCallback):
        def __init__(self):
            self.done = threading.Event()

        def on_complete(self):
            self.done.set()

        def on_error(self, result):
            self.done.set()

        def on_event(self, result):
            pass

    # 统一转为 WAV 16kHz 单声道（Recognition 对 MP3 等格式不稳定）
    wav_path = None
    actual_path = file_path
    fmt, sr = _probe_audio(file_path)
    if fmt != "wav" or sr != 16000:
        wav_path = tempfile.mktemp(suffix=".wav")
        sp.run(
            ["ffmpeg", "-i", file_path, "-ar", "16000", "-ac", "1", "-y", wav_path],
            capture_output=True, timeout=60,
        )
        actual_path = wav_path
        fmt, sr = "wav", 16000

    try:
        cb = _Callback()
        rec = Recognition(
            model="paraformer-realtime-v2",
            callback=cb,
            format=fmt,
            sample_rate=sr,
            diarization_enabled=True,
        )
        result = rec.call(actual_path)
        cb.done.wait(timeout=600)
    finally:
        if wav_path and os.path.exists(wav_path):
            os.unlink(wav_path)

    if result.status_code != 200:
        output = {"error": f"Recognition failed: code={result.status_code} msg={result.message}"}
    else:
        sentences = result.get_sentence() or []
        output = {
            "sentences": [
                {
                    "text": s.get("text", ""),
                    "begin_time": s.get("begin_time", 0),
                    "end_time": s.get("end_time", 0),
                    "speaker_id": s.get("speaker_id"),
                }
                for s in sentences
            ]
        }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)


def _probe_audio(file_path: str) -> tuple:
    """探测音频格式和采样率"""
    import subprocess as sp

    try:
        out = sp.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", file_path],
            capture_output=True, text=True, timeout=10,
        )
        info = json.loads(out.stdout)
        stream = next((s for s in info.get("streams", []) if s["codec_type"] == "audio"), None)
        if stream:
            sr = int(stream.get("sample_rate", 16000))
            codec = stream.get("codec_name", "")
            fmt_map = {"mp3": "mp3", "aac": "aac", "pcm_s16le": "pcm", "flac": "flac",
                       "opus": "opus", "vorbis": "ogg"}
            return fmt_map.get(codec, "wav"), sr
    except Exception:
        pass
    return "wav", 16000


if __name__ == "__main__":
    main()
