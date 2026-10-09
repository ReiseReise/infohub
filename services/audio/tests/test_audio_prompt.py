import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

fake_config = types.ModuleType("app.config")
fake_config.settings = SimpleNamespace(dashscope_api_key="")
sys.modules.setdefault("app.config", fake_config)

try:
    from app.services.prompt_service import render_prompt  # noqa: E402
except ModuleNotFoundError:
    render_prompt = None


class AudioPromptTests(unittest.TestCase):
    @unittest.skipIf(render_prompt is None, "host Python 未安装音频服务模板依赖")
    def test_every_template_render_requires_simplified_chinese_output(self):
        rendered = render_prompt("Title: {{ audio_title }}", {"audio_title": "English podcast"})

        self.assertIn("始终使用简体中文", rendered)
        self.assertIn("不要因为逐字稿是英文就改用英文输出", rendered)
        self.assertIn("Title: English podcast", rendered)


if __name__ == "__main__":
    unittest.main()
