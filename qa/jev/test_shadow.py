import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('jev_shadow', ROOT / 'scripts/research/jev-shadow.py')
jev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jev)


def valid():
    options = jev.QUESTIONS['topic']['criteria']
    return {'model': jev.MODEL, 'answers': {
        'relevant': {'type': 'noul', 'noul': .95},
        'sufficient': {'type': 'noul', 'noul': .95},
        'topic': {'type': 'choice', 'choice': 'technology', 'confidence': .95,
                  'probabilities': {k: float(k == 'technology') for k in options}}},
        'usage': {'input_tokens': 500, 'output_tokens': 30}}


class SmokeTests(unittest.TestCase):
    def setUp(self):
        self.rows = jev.load_cases(ROOT / 'qa/jev/synthetic-cases.jsonl')

    def test_offline_never_calls_network(self):
        def fail(*args):
            raise AssertionError('Network forbidden')
        report = jev.execute(self.rows, caller=fail)
        self.assertEqual(report['successful_calls'], 0)
        self.assertEqual(len(report['cases']), 8)
        self.assertIsNone(report['semantic_accuracy'])

    def test_missing_key_blocks(self):
        self.assertEqual(jev.execute(self.rows, live=True)['status'], 'blocked_missing_TYPESAFE_API_KEY')

    def test_labels_excluded(self):
        body = jev.payload(self.rows[0])
        self.assertEqual(set(body['state']), {'title', 'text'})
        self.assertNotIn('probe', jev.encoded(body).decode())

    def test_reject_bad_response(self):
        for mutate in [lambda r: r.update(model='other'),
                       lambda r: r['answers']['relevant'].update(noul=float('nan')),
                       lambda r: r['answers']['relevant'].update(noul=True),
                       lambda r: r['answers']['topic'].update(choice='invented'),
                       lambda r: r['answers']['topic']['probabilities'].update(technology=.1),
                       lambda r: r['usage'].update(input_tokens=-1)]:
            response = valid()
            mutate(response)
            with self.assertRaises(ValueError):
                jev.validate_response(response)

    def test_low_confidence_preserves_original(self):
        response = valid()
        response['answers']['topic']['confidence'] = .2
        self.assertEqual(jev.suggestion(response), 'review_keep_original')

    def test_failure_stops_and_redacts(self):
        calls = []
        def fail(*args):
            calls.append(1)
            raise RuntimeError('SECRET_SENTINEL')
        report = jev.execute(self.rows, True, 'dummy', fail)
        self.assertEqual(len(calls), 1)
        self.assertNotIn('SECRET_SENTINEL', jev.encoded(report).decode())
        self.assertEqual(report['status'], 'stopped_on_failure')

    def test_fake_transport_is_not_accuracy_evidence(self):
        report = jev.execute(self.rows, True, 'dummy', lambda *args: copy.deepcopy(valid()))
        self.assertEqual(report['successful_calls'], 8)
        self.assertIsNone(report['semantic_accuracy'])
        self.assertEqual(report['production_mutations'], 0)
        self.assertAlmostEqual(report['estimated_usd_successes_only'], .000168)


if __name__ == '__main__':
    unittest.main()
