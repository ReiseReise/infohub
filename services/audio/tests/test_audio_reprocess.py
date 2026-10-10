import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.audio_reprocess import (  # noqa: E402
    has_reusable_transcript,
    has_reusable_summary,
    metadata_only_summary,
    resolve_effective_task_status,
    resolve_reprocess_stage,
)


class AudioReprocessTests(unittest.TestCase):
    def test_auto_reuses_existing_transcript_and_only_rebuilds_summary(self):
        stage = resolve_reprocess_stage(
            "auto",
            transcript_text="有效逐字稿" * 30,
            transcript_raw={"segments": []},
        )
        self.assertEqual(stage, "summary")

    def test_auto_restarts_full_pipeline_without_transcript(self):
        stage = resolve_reprocess_stage("auto", transcript_text="", transcript_raw=None)
        self.assertEqual(stage, "full")

    def test_segment_text_is_enough_for_summary_resume(self):
        raw = {"segments": [{"start": 0, "end": 2, "text": "一句真实转写"}]}
        self.assertTrue(has_reusable_transcript("", raw))
        self.assertEqual(
            resolve_reprocess_stage("summary", transcript_text="", transcript_raw=raw),
            "summary",
        )

    def test_summary_resume_without_transcript_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "没有可复用的逐字稿"):
            resolve_reprocess_stage("summary", transcript_text="", transcript_raw=None)

    def test_metadata_preserves_last_good_summary_and_assets_for_summary_resume(self):
        summary = {
            "text": "旧纪要仍然是可阅读的完整结果" * 3,
            "model": "summary-model",
            "input_tokens": 120,
            "output_tokens": 60,
            "_callback": {"webhook_url": "https://example.invalid/hook"},
            "artifacts": {"schema": "audio_artifacts_v1", "qa": {"answers": [{"id": "qa-1"}]}},
        }
        raw = {"_source_meta": {"source_kind": "upload", "asr_mode": "remote_batch"}}

        result = metadata_only_summary(summary, raw, preserve_artifacts=True)

        self.assertTrue(has_reusable_summary(result))
        self.assertEqual(result["text"], summary["text"])
        self.assertEqual(result["model"], "summary-model")
        self.assertEqual(result["input_tokens"], 120)
        self.assertEqual(result["output_tokens"], 60)
        self.assertEqual(result["_source_meta"]["asr_mode"], "remote_batch")
        self.assertEqual(result["_callback"]["webhook_url"], "https://example.invalid/hook")
        self.assertEqual(result["artifacts"]["qa"]["answers"][0]["id"], "qa-1")

    def test_full_restart_does_not_keep_old_assets(self):
        result = metadata_only_summary(
            {"artifacts": {"schema": "audio_artifacts_v1"}},
            {"_source_meta": {"source_kind": "upload"}},
            preserve_artifacts=False,
        )
        self.assertNotIn("artifacts", result)
        self.assertEqual(result["_source_meta"]["source_kind"], "upload")

    def test_failed_retry_with_complete_assets_is_exposed_as_done(self):
        status = resolve_effective_task_status(
            "failed",
            transcript_text="有效逐字稿" * 30,
            transcript_raw={"segments": []},
            summary_result={"text": "完整纪要" * 20},
        )
        self.assertEqual(status, "done")

    def test_failed_task_without_summary_remains_failed(self):
        status = resolve_effective_task_status(
            "failed",
            transcript_text="有效逐字稿" * 30,
            transcript_raw={"segments": []},
            summary_result={"artifacts": {"schema": "audio_artifacts_v1"}},
        )
        self.assertEqual(status, "failed")


if __name__ == "__main__":
    unittest.main()
