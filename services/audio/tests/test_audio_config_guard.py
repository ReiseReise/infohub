import unittest

from app.services.audio_config_guard import (
    AUDIO_PROMPT_CATEGORIES,
    DEFAULT_ENDPOINT_SENTINEL,
    is_audio_prompt_category,
    require_audio_llm_selection,
    resolve_audio_llm_selection,
    validate_model_config_target,
)


class AudioConfigGuardTests(unittest.TestCase):
    def test_only_audio_prompt_categories_are_allowed(self):
        for category in AUDIO_PROMPT_CATEGORIES:
            self.assertTrue(is_audio_prompt_category(category))
        for category in ("feed_summary", "daily_report_final", "custom", ""):
            self.assertFalse(is_audio_prompt_category(category))

    def test_model_config_requires_provider_and_model(self):
        with self.assertRaisesRegex(ValueError, "供应商"):
            validate_model_config_target("", "qwen-max")
        with self.assertRaisesRegex(ValueError, "模型名称"):
            validate_model_config_target("dashscope", "")

    def test_endpoint_requires_ark_provider(self):
        with self.assertRaisesRegex(ValueError, "Volcengine Ark"):
            validate_model_config_target("dashscope", "ep-bad")
        self.assertEqual(
            validate_model_config_target("volcengine_ark", "ep-valid"),
            ("volcengine_ark", "ep-valid"),
        )

    def test_deepseek_uses_the_verified_official_model_id(self):
        self.assertEqual(
            validate_model_config_target("deepseek", "deepseek-v4-flash"),
            ("deepseek", "deepseek-flash"),
        )
        with self.assertRaisesRegex(ValueError, "deepseek-flash"):
            validate_model_config_target("deepseek", "deepseek-chat")

    def test_deepseek_current_ids_and_legacy_aliases(self):
        for alias in ("deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"):
            self.assertEqual(validate_model_config_target("deepseek", alias), ("deepseek", "deepseek-flash"))
        self.assertEqual(validate_model_config_target("deepseek", "deepseek-v4-pro"), ("deepseek", "deepseek-v4-pro"))

    def test_default_endpoint_selection_requires_endpoint_and_key(self):
        missing = resolve_audio_llm_selection(
            DEFAULT_ENDPOINT_SENTINEL,
            default_endpoint_id="",
            has_ark_key=True,
            has_dashscope_key=True,
        )
        self.assertFalse(missing.available)
        valid = require_audio_llm_selection(
            DEFAULT_ENDPOINT_SENTINEL,
            default_endpoint_id="ep-valid",
            has_ark_key=True,
            has_dashscope_key=False,
        )
        self.assertEqual(valid.provider, "volcengine_ark")

    def test_automatic_selection_can_use_dashscope_fallback(self):
        selection = require_audio_llm_selection(
            "",
            default_endpoint_id="",
            has_ark_key=False,
            has_dashscope_key=True,
        )
        self.assertEqual(selection.model, "dashscope/qwen-flash")

    def test_naked_endpoint_is_rejected_before_task_start(self):
        with self.assertRaisesRegex(ValueError, "裸 Endpoint"):
            require_audio_llm_selection(
                "ep-unbound",
                default_endpoint_id="ep-default",
                has_ark_key=True,
                has_dashscope_key=True,
            )


if __name__ == "__main__":
    unittest.main()
