"""Run the real route with an isolated identity map and row-lock model.

No server, model credentials or SQLAlchemy installation are needed. This checks
the route's persistence protocol; it does not replace a PostgreSQL integration test.
"""
from __future__ import annotations

import ast
import asyncio
import copy
import json
import sys
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.audio_artifacts import build_audio_artifacts_v1  # noqa: E402
from app.services.audio_qa import (  # noqa: E402
    build_audio_qa_answer,
    build_audio_qa_prompt,
    select_audio_qa_evidence,
    upsert_audio_qa_answer,
)


class RouteError(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code


class Field:
    def __eq__(self, _other):
        return self


def load_route(namespace):
    source = ROOT / "app/api/tasks.py"
    module = ast.parse(source.read_text())
    function = next(node for node in module.body
                    if isinstance(node, ast.AsyncFunctionDef) and node.name == "generate_task_qa")
    function.decorator_list = []
    isolated = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), function], type_ignores=[])
    ast.fix_missing_locations(isolated)
    exec(compile(isolated, str(source), "exec"), namespace)
    return namespace["generate_task_qa"]


class PersistenceFixture:
    def __init__(self, *, ignore_lock=False, ignore_refresh=False, invalid_answer=False):
        self.ignore_lock = ignore_lock
        self.ignore_refresh = ignore_refresh
        self.invalid_answer = invalid_answer
        self.lock = asyncio.Lock()
        self.model_barrier = asyncio.Event()
        self.calls = 0
        self.logs = []
        self.task_id = uuid.UUID("00000000-0000-4000-8000-000000000001")
        self.user_id = uuid.UUID("00000000-0000-4000-8000-000000000002")
        self.stored = SimpleNamespace(
            id=self.task_id, user_id=self.user_id, title="Fixture audio", llm_model="fixture",
            transcript_text="Synthetic timed evidence. " * 10,
            transcript_raw={"segments": [{"start": 0, "end": 20, "text": "Synthetic timed evidence for the fixture."}]},
            summary_result={"text": "Previously saved summary.", "artifacts": {
                "schema": "audio_artifacts_v1", "qa": {"suggestions": [], "answers": []},
            }}, llm_cost=0.3,
        )
        fixture = self

        class Query:
            locked = False
            populate = False

            def where(self, *_conditions):
                return self

            def with_for_update(self):
                self.locked = not fixture.ignore_lock
                return self

            def execution_options(self, **options):
                self.populate = options.get("populate_existing", False) and not fixture.ignore_refresh
                return self

        class Session:
            task = None
            owns_lock = False

            async def execute(self, query):
                if query.locked:
                    await fixture.lock.acquire()
                    self.owns_lock = True
                if self.task is None:
                    self.task = copy.deepcopy(fixture.stored)
                elif query.populate:
                    self.task.__dict__.update(copy.deepcopy(fixture.stored.__dict__))
                # Both unlocked reads can observe the same committed row.
                await asyncio.sleep(0)
                return SimpleNamespace(scalar_one_or_none=lambda: self.task)

            def add(self, record):
                fixture.logs.append(record)

            async def commit(self):
                await asyncio.sleep(0)
                fixture.stored = copy.deepcopy(self.task)
                if self.owns_lock:
                    self.owns_lock = False
                    fixture.lock.release()

            async def refresh(self, _task):
                pass

        class FixtureLLM:
            async def complete(self, **_kwargs):
                fixture.calls += 1
                if fixture.calls == 2 or fixture.invalid_answer:
                    fixture.model_barrier.set()
                await fixture.model_barrier.wait()
                response = {"answer": "Synthetic answer [E1]", "citations": ["E1"]}
                if fixture.invalid_answer:
                    response = {"answer": "Unverified answer", "citations": []}
                return SimpleNamespace(
                    text=json.dumps(response), model="fixture", provider="fixture",
                    input_tokens=10, output_tokens=10, total_tokens=20, estimated_cost=0.1,
                    latency_ms=1, provider_request_id=None, api_kind="fixture", endpoint_id=None,
                )

        self.Session = Session
        self.route = load_route({
            "uuid": uuid, "select": lambda _: Query(),
            "AudioTask": SimpleNamespace(id=Field(), user_id=Field()),
            "Depends": lambda _: None, "get_db": lambda: None, "get_current_user": lambda: None,
            "HTTPException": RouteError, "_normalize_text": lambda text: " ".join((text or "").split()),
            "_assert_audio_llm_ready": lambda _: SimpleNamespace(model="fixture", provider="fixture"),
            "_extract_summary_text": lambda task: task.summary_result.get("text", ""),
            "select_audio_qa_evidence": select_audio_qa_evidence,
            "build_audio_qa_prompt": build_audio_qa_prompt,
            "build_audio_qa_answer": build_audio_qa_answer,
            "upsert_audio_qa_answer": upsert_audio_qa_answer,
            "build_audio_artifacts_v1": build_audio_artifacts_v1,
            "LLMService": FixtureLLM, "UsageLog": lambda **kwargs: SimpleNamespace(**kwargs),
            "ServiceType": SimpleNamespace(llm=SimpleNamespace(value="llm")),
            "AudioQaResponse": lambda **kwargs: kwargs,
            "_task_to_response": lambda task: task.summary_result,
        })

    async def ask(self, question):
        return await self.route(str(self.task_id), SimpleNamespace(question=question, prompt_key=None),
                                self.Session(), SimpleNamespace(id=self.user_id))

    async def ask_concurrently(self):
        return await asyncio.gather(self.ask("First finding?"), self.ask("Second finding?"))


class AudioQaPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_answers_preserve_summary_both_answers_and_total_cost(self):
        fixture = PersistenceFixture()
        responses = await fixture.ask_concurrently()
        saved = fixture.stored.summary_result
        self.assertEqual(len(responses), 2)
        self.assertEqual(saved["text"], "Previously saved summary.")
        self.assertEqual({answer["question"] for answer in saved["artifacts"]["qa"]["answers"]},
                         {"First finding?", "Second finding?"})
        self.assertAlmostEqual(fixture.stored.llm_cost, 0.5)
        self.assertEqual(len(fixture.logs), 2)
        self.assertFalse(fixture.lock.locked())

    async def test_fixture_detects_missing_lock_or_missing_identity_map_refresh(self):
        for mutation in ("ignore_lock", "ignore_refresh"):
            with self.subTest(mutation=mutation):
                fixture = PersistenceFixture(**{mutation: True})
                await fixture.ask_concurrently()
                self.assertEqual(len(fixture.stored.summary_result["artifacts"]["qa"]["answers"]), 1)
                self.assertAlmostEqual(fixture.stored.llm_cost, 0.4)

    async def test_invalid_model_answer_does_not_replace_existing_summary_or_answers(self):
        fixture = PersistenceFixture(invalid_answer=True)
        before = copy.deepcopy(fixture.stored.summary_result)
        with self.assertRaises(RouteError) as failure:
            await fixture.ask("What is verified?")
        self.assertEqual(failure.exception.status_code, 502)
        self.assertEqual(fixture.stored.summary_result, before)
        self.assertAlmostEqual(fixture.stored.llm_cost, 0.3)
        self.assertEqual(len(fixture.logs), 1)
        self.assertTrue(fixture.logs[0].error_message)


if __name__ == "__main__":
    unittest.main()
