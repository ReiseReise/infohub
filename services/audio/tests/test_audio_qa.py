import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.audio_qa import (  # noqa: E402
    build_audio_qa_answer,
    build_audio_qa_prompt,
    parse_audio_qa_response,
    select_audio_qa_evidence,
    upsert_audio_qa_answer,
)


TRANSCRIPT = {
    "segments": [
        {"start": 10, "end": 20, "text": "今天先说项目背景和目标", "speaker": "A"},
        {"start": 120, "end": 132, "text": "当前最大风险是测试样本不足，需要补齐数据", "speaker": "B"},
        {"start": 240, "end": 252, "text": "下一步由张三在周五前完成回归测试", "speaker": "A"},
        {"start": 360, "end": 372, "text": "最后确认发布时间仍然待定", "speaker": "B"},
    ]
}


class AudioQaTests(unittest.TestCase):
    def test_selects_relevant_timed_evidence(self):
        evidence = select_audio_qa_evidence(
            TRANSCRIPT,
            "项目有什么风险？",
            prompt_key="risks",
            limit=3,
        )
        self.assertTrue(any(item["start"] == 120 for item in evidence))
        self.assertEqual([item["evidence_id"] for item in evidence], [f"E{i + 1}" for i in range(len(evidence))])

    def test_prompt_exposes_evidence_ids_and_timestamps(self):
        evidence = select_audio_qa_evidence(TRANSCRIPT, "下一步是什么？", prompt_key="actions", limit=3)
        prompt = build_audio_qa_prompt(
            title="项目复盘",
            question="下一步是什么？",
            summary_text="需要完成回归。",
            evidence=evidence,
        )
        self.assertIn("[E", prompt)
        self.assertIn("4:00-4:12", prompt)
        self.assertIn("严格 JSON", prompt)

    def test_parses_and_replaces_verified_citations(self):
        evidence = select_audio_qa_evidence(TRANSCRIPT, "有什么风险？", prompt_key="risks", limit=4)
        answer, citations = parse_audio_qa_response(
            '{"answer":"样本不足是主要风险 [E2]","citations":["E2"]}',
            evidence,
        )
        self.assertIn("〔", answer)
        self.assertEqual(len(citations), 1)
        self.assertEqual(citations[0]["source"], "asr")

    def test_maps_model_timestamp_citations_to_real_asr_evidence(self):
        evidence = select_audio_qa_evidence(TRANSCRIPT, "下一步是什么？", prompt_key="actions", limit=4)
        answer, citations = parse_audio_qa_response(
            '{"answer":"\n**结论**\n\n周五前完成回归测试 [04:01]", "citations":["04:01"]}',
            evidence,
        )
        self.assertIn("**结论**", answer)
        self.assertIn("\n\n", answer)
        self.assertEqual(len(citations), 1)
        self.assertEqual(citations[0]["start"], 240)

    def test_unwraps_double_encoded_model_json(self):
        evidence = select_audio_qa_evidence(TRANSCRIPT, "下一步是什么？", prompt_key="actions", limit=4)
        nested = '{"answer":"**结论**\n\n周五前完成回归测试 [E3]","citations":["E3"]}'
        raw_response = json.dumps({"answer": nested, "citations": ["04:01"]}, ensure_ascii=False)
        answer, citations = parse_audio_qa_response(raw_response, evidence)
        self.assertTrue(answer.startswith("**结论**"))
        self.assertNotIn('{"answer"', answer)
        self.assertEqual(citations[0]["start"], 240)

    def test_accepts_bare_evidence_id_and_timestamp_range_from_model(self):
        evidence = select_audio_qa_evidence(TRANSCRIPT, "下一步是什么？", prompt_key="actions", limit=4)
        answer, citations = parse_audio_qa_response(
            '{"answer":"周五前完成回归测试（依据：E3 [4:00-4:12]）","citations":[]}',
            evidence,
        )
        self.assertIn("〔4:00-4:12〕", answer)
        self.assertEqual(len(citations), 1)
        self.assertEqual(citations[0]["start"], 240)

    def test_rejects_timestamp_far_from_selected_evidence(self):
        evidence = select_audio_qa_evidence(TRANSCRIPT, "结论？", prompt_key="summary", limit=3)
        with self.assertRaisesRegex(ValueError, "没有可核验"):
            parse_audio_qa_response(
                '{"answer":"这是一个越界时间点 [59:59]", "citations":["59:59"]}',
                evidence,
            )

    def test_rejects_answer_without_valid_citation(self):
        evidence = select_audio_qa_evidence(TRANSCRIPT, "结论？", prompt_key="summary", limit=3)
        with self.assertRaisesRegex(ValueError, "没有可核验"):
            parse_audio_qa_response('{"answer":"这是一个没有证据的结论","citations":[]}', evidence)

    def test_upserts_same_prompt_key_and_preserves_other_answers(self):
        evidence = select_audio_qa_evidence(TRANSCRIPT, "总结", prompt_key="summary", limit=3)
        first = build_audio_qa_answer(
            question="总结",
            prompt_key="summary",
            raw_response='{"answer":"旧回答 [E1]","citations":["E1"]}',
            evidence=evidence,
            model="model-a",
            provider="test",
            input_tokens=10,
            output_tokens=5,
        )
        second = build_audio_qa_answer(
            question="重新总结",
            prompt_key="summary",
            raw_response='{"answer":"新回答 [E2]","citations":["E2"]}',
            evidence=evidence,
            model="model-a",
            provider="test",
            input_tokens=10,
            output_tokens=5,
        )
        artifacts = upsert_audio_qa_answer({"qa": {"suggestions": [], "answers": []}}, first)
        artifacts = upsert_audio_qa_answer(artifacts, second)
        self.assertEqual(len(artifacts["qa"]["answers"]), 1)
        self.assertEqual(artifacts["qa"]["answers"][0]["question"], "重新总结")


if __name__ == "__main__":
    unittest.main()
