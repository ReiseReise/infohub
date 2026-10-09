import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.audio_artifacts import (  # noqa: E402
    ARTIFACT_SCHEMA,
    build_audio_artifacts_v1,
    preserve_audio_qa_answers,
)


class AudioArtifactsTests(unittest.TestCase):
    def test_builds_versioned_assets_from_summary_and_timed_segments(self):
        artifacts = build_audio_artifacts_v1(
            title="项目复盘",
            summary_text=(
                "# 项目复盘\n"
                "## 进展与结论\n项目已完成核心验证。\n- 需要张三下周完成回归\n"
                "## 风险与后续\n当前风险是数据样本不足。\n- 下一步补齐样本"
            ),
            transcript_text="我们需要完成回归。当前风险是数据不足。",
            transcript_raw={
                "segments": [
                    {"start": 10, "end": 20, "text": "我们需要完成回归", "speaker": "speaker-1"},
                    {"start": 50, "end": 70, "text": "当前风险是数据样本不足", "speaker": "speaker-2"},
                ]
            },
        )

        self.assertEqual(artifacts["schema"], ARTIFACT_SCHEMA)
        self.assertEqual(artifacts["version"], 1)
        self.assertEqual(len(artifacts["chapters"]), 2)
        self.assertEqual(artifacts["chapters"][0]["start"], 10)
        self.assertEqual(artifacts["chapters"][1]["end"], 70)
        self.assertEqual(artifacts["chapters"][0]["speakers"], ["speaker-1"])
        self.assertGreaterEqual(len(artifacts["highlights"]), 2)
        self.assertEqual(artifacts["mind_map"]["root"], "项目复盘")
        self.assertEqual(len(artifacts["action_items"]), 2)
        self.assertEqual(len(artifacts["qa"]["suggestions"]), 4)
        self.assertEqual(artifacts["qa"]["answers"], [])

    def test_empty_materials_do_not_create_fake_assets(self):
        artifacts = build_audio_artifacts_v1(
            title="空任务",
            summary_text="",
            transcript_text="",
            transcript_raw=None,
        )
        self.assertEqual(artifacts["chapters"], [])
        self.assertEqual(artifacts["highlights"], [])
        self.assertEqual(artifacts["action_items"], [])
        self.assertEqual(artifacts["basis"]["timed_segments"], 0)

    def test_uses_ai_timestamp_topics_for_chapter_boundaries(self):
        artifacts = build_audio_artifacts_v1(
            title="AI 办公室",
            summary_text=(
                "# AI 办公室\n## 核心论点\n"
                "- 为 AI 建立安全工作环境 [02:00]\n"
                "- 让任务形成自动验证闭环 [12:00]\n"
                "- 将经验固化为团队技能 [24:00]"
            ),
            transcript_text="开场 环境 自动验证 团队技能",
            transcript_raw={
                "segments": [
                    {"start": 0, "end": 119, "text": "开场背景", "speaker": "A"},
                    {"start": 120, "end": 719, "text": "讨论安全工作环境", "speaker": "A"},
                    {"start": 720, "end": 1439, "text": "讨论自动验证闭环", "speaker": "B"},
                    {"start": 1440, "end": 1800, "text": "讨论团队技能", "speaker": "A"},
                ]
            },
        )

        self.assertEqual(artifacts["basis"]["topic_anchors"], 3)
        self.assertEqual([chapter["start"] for chapter in artifacts["chapters"]], [0, 120, 720, 1440])
        self.assertEqual(artifacts["chapters"][1]["source"], "summary_timestamp+asr")
        self.assertEqual(artifacts["chapters"][2]["speakers"], ["B"])

    def test_quick_assets_ignore_markdown_tables_separators_and_full_transcript_sections(self):
        artifacts = build_audio_artifacts_v1(
            title="项目复盘",
            summary_text=(
                "# 项目复盘\n"
                "## 关键结论\n"
                "建议先完成真实环境验收。[02:00]\n"
                "| 项目 | 状态 |\n"
                "| --- | --- |\n"
                "| 回归 | 进行中 |\n"
                "---\n"
                "## 下一步\n"
                "- 负责人需要在周五前补齐证据\n"
                "## 完整逐字稿\n"
                "[08:00] 下一步下一步下一步，这是一整段不应进入快速洞察的逐字稿内容。\n"
                "| 逐字稿 | 污染 |"
            ),
            transcript_text="建议先完成验收。负责人需要补齐证据。",
            transcript_raw={
                "segments": [
                    {"start": 30, "end": 40, "text": "这些可能性需要时间发酵，有很多可能是错的", "speaker": "A"},
                    {"start": 120, "end": 135, "text": "建议先完成真实环境验收", "speaker": "A"},
                    {"start": 300, "end": 315, "text": "| 项目 | 状态 |", "speaker": "A"},
                    {"start": 420, "end": 440, "text": "负责人需要在周五前补齐证据", "speaker": "B"},
                    {"start": 480, "end": 500, "text": "---", "speaker": "B"},
                ]
            },
        )

        serialized = str(artifacts)
        self.assertNotIn("完整逐字稿", serialized)
        self.assertNotIn("| 项目 | 状态 |", serialized)
        self.assertNotIn("下一步下一步下一步", serialized)
        self.assertEqual(artifacts["basis"]["topic_anchors"], 1)
        self.assertEqual(len(artifacts["chapters"]), 2)
        self.assertEqual(len(artifacts["action_items"]), 2)
        self.assertEqual([item["start"] for item in artifacts["highlights"]], [120.0, 420.0])

    def test_heading_without_content_is_not_exposed_as_empty_chapter(self):
        artifacts = build_audio_artifacts_v1(
            title="长播客",
            summary_text=(
                "### 文艺复兴、佛罗伦萨与印刷机革命：结构化中文总结\n"
                "#### 一、佛罗伦萨的政治与权力结构\n"
                "佛罗伦萨通过商人行会与抽签制度形成共和治理。\n"
                "#### 二、印刷机带来的信息革命\n"
                "印刷技术显著降低了知识传播成本。"
            ),
            transcript_text="佛罗伦萨共和治理。印刷技术带来信息革命。",
            transcript_raw={
                "segments": [
                    {"start": 0, "end": 100, "text": "佛罗伦萨共和治理"},
                    {"start": 100, "end": 200, "text": "印刷技术带来信息革命"},
                ]
            },
        )

        self.assertEqual(len(artifacts["chapters"]), 2)
        serialized = str(artifacts)
        self.assertNotIn("暂无可读摘要", serialized)
        self.assertNotEqual(artifacts["chapters"][0]["title"], "文艺复兴、佛罗伦萨与印刷机革命：结构化中文总结")

    def test_rebuild_preserves_verified_qa_answers(self):
        rebuilt = build_audio_artifacts_v1(
            title="项目复盘",
            summary_text="# 项目复盘\n## 结论\n建议先完成验收。",
            transcript_text="建议先完成验收。",
            transcript_raw={"segments": [{"start": 10, "end": 20, "text": "建议先完成验收"}]},
        )
        previous = {
            "qa": {
                "answers": [{
                    "id": "qa-1",
                    "question": "下一步是什么？",
                    "answer": "先完成验收。",
                    "citations": [{"start": 10, "end": 20, "text": "建议先完成验收"}],
                }]
            }
        }

        merged = preserve_audio_qa_answers(rebuilt, previous)

        self.assertEqual(merged["qa"]["answers"][0]["id"], "qa-1")


if __name__ == "__main__":
    unittest.main()
