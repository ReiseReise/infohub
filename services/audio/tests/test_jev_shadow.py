import ast
from pathlib import Path
import unittest


class JevShadowBoundaryTests(unittest.TestCase):
    def test_internal_notification_sends_reference_only(self):
        source = (Path(__file__).parents[1] / 'app/services/jev_shadow.py').read_text()
        tree = ast.parse(source)
        posts = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'post']
        self.assertEqual(len(posts), 1)
        payload = next(k.value for k in posts[0].keywords if k.arg == 'json')
        self.assertEqual([k.value for k in payload.keys], ['itemId'])
        self.assertNotIn('TYPESAFE_API_KEY', source)
        self.assertIn('follow_redirects=False', source)
        self.assertIn('JEV_ENABLED', source)

    def test_notification_occurs_before_summary(self):
        source = (Path(__file__).parents[1] / 'app/tasks/audio_pipeline.py').read_text()
        self.assertLess(source.index('await notify_transcript_ready'), source.index('llm_result = await llm_service.summarize_long_text'))
