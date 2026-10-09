import os
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

fake_config = types.ModuleType("app.config")
fake_config.settings = SimpleNamespace(dashscope_api_key="")
sys.modules.setdefault("app.config", fake_config)

from app.services.asr_service import (  # noqa: E402
    DEFAULT_CHUNK_RETRIES,
    DEFAULT_LOCAL_CHUNK_SECONDS,
    ParaformerASR,
    Segment,
    TranscriptionResult,
)


class AudioChunkingTests(unittest.TestCase):
    def setUp(self):
        self.provider = ParaformerASR(api_key="test-key")

    def test_default_chunk_is_fifteen_minutes(self):
        self.assertEqual(DEFAULT_LOCAL_CHUNK_SECONDS, 900)
        self.assertEqual(self.provider._chunk_seconds_for_duration(7_200), 900)

    def test_medium_audio_uses_five_minute_chunks(self):
        self.assertEqual(self.provider._chunk_seconds_for_duration(779), 300)

    def test_short_timeout_fallback_can_force_smaller_chunks(self):
        expected = TranscriptionResult(text="ok", duration=779)
        with patch.object(self.provider, "_probe_audio_details", return_value=("wav", 16000, 779)), patch.object(
            self.provider, "_transcribe_local_chunked", return_value=expected
        ) as chunked:
            result = self.provider.transcribe_local_sync("sample.wav", chunk_seconds=180)

        self.assertIs(result, expected)
        self.assertEqual(chunked.call_args.kwargs["chunk_seconds"], 180)

    def test_each_chunk_retries_before_failing_the_whole_audio(self):
        recovered = TranscriptionResult(
            text="recovered",
            segments=[Segment(start=1, end=2, text="recovered")],
            duration=10,
        )
        progress = []
        with patch.object(
            self.provider,
            "_transcribe_single_local_sync",
            side_effect=[TimeoutError("first timeout"), recovered],
        ) as transcribe:
            result, attempts = self.provider._transcribe_chunk_with_retry(
                "chunk.wav",
                speaker_diarization=True,
                timeout_seconds=120,
                max_retries=DEFAULT_CHUNK_RETRIES,
                chunk_index=0,
                chunk_count=2,
                progress_callback=progress.append,
            )

        self.assertIs(result, recovered)
        self.assertEqual(attempts, 2)
        self.assertEqual(transcribe.call_count, 2)
        self.assertEqual(progress[-1]["stage"], "completed")
        self.assertEqual(progress[-1]["attempt"], 2)

    def test_chunk_merge_keeps_global_time_offsets(self):
        first = TranscriptionResult(
            text="first",
            segments=[Segment(start=1, end=3, text="first", speaker="speaker-1")],
            speakers=["speaker-1"],
        )
        second = TranscriptionResult(
            text="second",
            segments=[Segment(start=2, end=5, text="second", speaker="speaker-2")],
            speakers=["speaker-2"],
        )

        def fake_split(command, **_kwargs):
            pattern = command[-1]
            Path(pattern.replace("%03d", "000")).touch()
            Path(pattern.replace("%03d", "001")).touch()
            return SimpleNamespace(returncode=0, stderr=b"")

        def fake_probe(path):
            return "wav", 16000, 900 if path.endswith("000.wav") else 300

        with patch("subprocess.run", side_effect=fake_split), patch.object(
            self.provider, "_probe_audio_details", side_effect=fake_probe
        ), patch.object(
            self.provider,
            "_transcribe_chunk_with_retry",
            side_effect=[(first, 1), (second, 2)],
        ):
            result = self.provider._transcribe_local_chunked("source.wav")

        self.assertEqual([segment.start for segment in result.segments], [1, 902])
        self.assertEqual([segment.end for segment in result.segments], [3, 905])
        self.assertEqual(result.duration, 1_200)
        chunking = result.raw_response["chunking"]
        self.assertEqual(chunking["chunk_seconds"], 900)
        self.assertEqual(chunking["chunk_count"], 2)
        self.assertEqual(chunking["chunks"][1]["attempts"], 2)


if __name__ == "__main__":
    unittest.main()
