import unittest

from app.services.model_config_sync import model_connection_settings_changed


class ModelConfigSyncTests(unittest.TestCase):
    def test_unchanged_connection_survives_restart_sync(self):
        self.assertFalse(model_connection_settings_changed(
            current_provider="volcengine_ark",
            current_model_name="ep-example",
            current_api_key="same-secret",
            current_base_url="https://ark.example/v3/",
            current_extra_config={"endpointId": "ep-example", "role": "default"},
            next_provider="VOLCENGINE_ARK",
            next_model_name="ep-example",
            next_api_key="same-secret",
            next_base_url="https://ark.example/v3",
            next_extra_config={"endpointId": "ep-example", "role": "default"},
        ))

    def test_connection_critical_changes_invalidate_verification(self):
        base = {
            "current_provider": "volcengine_ark",
            "current_model_name": "ep-example",
            "current_api_key": "old-secret",
            "current_base_url": "https://ark.example/v3",
            "current_extra_config": {"endpointId": "ep-example"},
            "next_provider": "volcengine_ark",
            "next_model_name": "ep-example",
            "next_api_key": "old-secret",
            "next_base_url": "https://ark.example/v3",
            "next_extra_config": {"endpointId": "ep-example"},
        }
        for patch in (
            {"next_provider": "dashscope"},
            {"next_model_name": "qwen-flash"},
            {"next_api_key": "new-secret"},
            {"next_base_url": "https://another.example/v3"},
            {"next_extra_config": {"endpointId": "ep-new"}},
        ):
            with self.subTest(patch=patch):
                self.assertTrue(model_connection_settings_changed(**{**base, **patch}))


if __name__ == "__main__":
    unittest.main()
