import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

try:
    from app.services.llm_service import LLMResult, LLMService
except ModuleNotFoundError as exc:  # pragma: no cover - host may not have service deps
    if exc.name in {"httpx", "pydantic_settings"}:
        LLMResult = None
        LLMService = None
    else:
        raise


@unittest.skipIf(LLMService is None, "audio service dependencies are not installed")
class AudioLongSummaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_ark_responses_forwards_thinking_to_the_actual_request(self):
        response = SimpleNamespace(status_code=200, headers={}, json=lambda: {
            "output": [{"type": "message", "content": [{"type": "output_text", "text": "ok"}]}],
            "usage": {},
        })
        client = AsyncMock()
        client.post.return_value = response
        context = AsyncMock()
        context.__aenter__.return_value = client
        with patch("app.services.llm_service.httpx.AsyncClient", return_value=context):
            await LLMService().complete(model="ep-test", provider="volcengine_ark", api_key="test-only",
                                        prompt="test", thinking={"type": "disabled"})
        self.assertEqual(client.post.await_args.kwargs["json"]["thinking"], {"type": "disabled"})

    def test_deepseek_target_uses_official_base_url_and_openai_compatible_route(self):
        target = LLMService._resolve_target(
            model="deepseek-v4-flash",
            provider="deepseek",
        )
        self.assertEqual(target["base_url"], "https://api.deepseek.com")
        self.assertEqual(target["model"], "openai/deepseek-v4-flash")
        self.assertEqual(target["api_kind"], "chat.completions")

    async def test_structured_completion_forwards_json_mode_and_disables_thinking(self):
        completion = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"blocks":[]}'))],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5, total_tokens=15),
            id="local-test",
        )
        fake_litellm = SimpleNamespace(
            acompletion=AsyncMock(return_value=completion),
            completion_cost=lambda **_: 0,
        )
        with patch.dict("sys.modules", {"litellm": fake_litellm}):
            await LLMService().complete(
                model="deepseek-v4-flash",
                provider="deepseek",
                api_key="test-only",
                prompt="Return JSON",
                response_format={"type": "json_object"},
                thinking={"type": "disabled"},
            )

        kwargs = fake_litellm.acompletion.await_args.kwargs
        self.assertEqual(kwargs["response_format"], {"type": "json_object"})
        self.assertEqual(kwargs["extra_body"], {"thinking": {"type": "disabled"}})

    async def test_chunk_and_merge_prompts_require_simplified_chinese(self):
        service = LLMService()
        prompts = []

        async def fake_complete(**kwargs):
            prompts.append(kwargs["prompt"])
            return LLMResult(
                text="这是一份包含足够中文内容的结构化纪要。" * 20,
                input_tokens=10,
                output_tokens=10,
                total_tokens=20,
                model="test-model",
                provider="test",
            )

        service.complete = fake_complete
        await service.summarize_long_text(
            transcript="A" * 600,
            rendered_prompt="B" * 600,
            model="test-model",
            max_chunk_tokens=300,
        )

        self.assertGreaterEqual(len(prompts), 3)
        self.assertTrue(all("简体中文" in prompt for prompt in prompts))

    async def test_english_summary_is_repaired_before_return(self):
        service = LLMService()
        prompts = []

        async def fake_complete(**kwargs):
            prompts.append(kwargs["prompt"])
            if len(prompts) == 1:
                return LLMResult(
                    text="This is an English summary with several sections and detailed evidence. " * 10,
                    input_tokens=20,
                    output_tokens=30,
                    total_tokens=50,
                    model="test-model",
                    provider="test",
                )
            return LLMResult(
                text="这是修复后的中文纪要，完整保留了标题、事实、证据和行动建议。" * 12,
                input_tokens=15,
                output_tokens=25,
                total_tokens=40,
                model="test-model",
                provider="test",
            )

        service.complete = fake_complete
        result = await service.summarize_long_text(
            transcript="short transcript",
            rendered_prompt="short rendered prompt",
            model="test-model",
        )

        self.assertEqual(len(prompts), 2)
        self.assertIn("错误地使用了英文", prompts[1])
        self.assertGreater(sum("\u4e00" <= char <= "\u9fff" for char in result.text), 80)
        self.assertEqual(result.total_tokens, 90)


if __name__ == "__main__":
    unittest.main()
