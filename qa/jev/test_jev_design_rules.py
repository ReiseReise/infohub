"""Boundary and shape tests for the offline design-point demo rules (docs/41 appendix).

These tests validate the local decision rules and request shapes only.
Mock answers are synthetic and are NOT evidence about the real model.
"""
import json
import math
import unittest

import jev_design_rules as rules


class QuestionShapeTests(unittest.TestCase):
    def test_question_types_are_api_valid(self):
        for key, q in rules.DESIGN_QUESTIONS.items():
            self.assertIn(q['type'], ('noul', 'choice', 'score'), key)
            self.assertTrue(q['instructions'].strip(), key)
            if q['type'] == 'choice':
                self.assertTrue(q['criteria'], key)
                self.assertLessEqual(len(q['criteria']), 255, key)
            if q['type'] == 'score':
                self.assertTrue(2 <= len(q['criteria']) <= 10, key)

    def test_request_shape(self):
        body = rules.build_request(
            ['substantial_change'],
            rules.build_monitor_state('盯价格页', 'old', 'new'))
        self.assertEqual(body['model'], rules.MODEL)
        self.assertEqual(set(body), {'model', 'state', 'questions'})
        self.assertEqual(set(body['state']),
                         {'monitoring_goal', 'old_snapshot_fragment', 'new_snapshot_fragment'})

    def test_unknown_question_key_rejected(self):
        with self.assertRaises(ValueError):
            rules.build_request(['nope'], {})

    def test_state_clipping_enforced(self):
        state = rules.build_same_event_state('t' * 500, 'p' * 99999, 'u' * 500, 'q' * 99999)
        # 100-token clip on titles, 700-token clip on openings (4 chars/token)
        self.assertLessEqual(len(state['piece_a']['title']), 400 + 1)
        self.assertLessEqual(len(state['piece_a']['opening']), 2800 + 1)


class MonitorRuleTests(unittest.TestCase):
    def test_boundary_values(self):
        self.assertEqual(rules.decide_monitor({'noul': 0.7})['reason'], 'substantial')
        self.assertEqual(rules.decide_monitor({'noul': 0.6999})['reason'], 'low_confidence')
        self.assertEqual(rules.decide_monitor({'noul': 0.4})['reason'], 'low_confidence')
        self.assertEqual(rules.decide_monitor({'noul': 0.3999})['reason'], 'noise')

    def test_noise_still_retains_diff(self):
        self.assertTrue(rules.decide_monitor({'noul': 0.01})['diff_retained'])

    def test_failure_always_reminds(self):
        self.assertEqual(rules.decide_monitor(None, request_failed=True)['action'], 'remind')


class EnrichmentRuleTests(unittest.TestCase):
    def _tier(self, choice, confidence=0.9):
        return {'choice': choice, 'confidence': confidence}

    def _density(self, probs):
        # Real API shape: dict keyed by level index, plus weighted 'score'.
        dist = {str(i): p for i, p in enumerate(probs)}
        weighted = sum(i * p for i, p in enumerate(probs))
        return {'probabilities': dist, 'score': weighted, 'confidence': 0.8}

    def test_skip_disabled_by_default(self):
        got = rules.decide_enrichment(self._tier('skip'), self._density([0.8, 0.1, 0.1]))
        self.assertEqual(got, {'tier': 'brief', 'source': 'jev_conservative_skip_disabled'})

    def test_low_confidence_goes_brief(self):
        got = rules.decide_enrichment(self._tier('full', confidence=0.49),
                                      self._density([0.1, 0.2, 0.7]))
        self.assertEqual(got['tier'], 'brief')

    def test_insufficient_goes_brief(self):
        got = rules.decide_enrichment(self._tier('insufficient'),
                                      self._density([0.3, 0.4, 0.3]))
        self.assertEqual(got['tier'], 'brief')

    def test_failure_degrades_to_full(self):
        self.assertEqual(rules.decide_enrichment(None, None, request_failed=True),
                         {'tier': 'full', 'source': 'jev_unavailable_fallback'})

    def test_weighted_density_computed(self):
        got = rules.decide_enrichment(self._tier('full'), self._density([0.0, 0.0, 1.0]))
        self.assertEqual(got['info_density'], 2.0)


class TranscriptionRuleTests(unittest.TestCase):
    def _ctype(self, choice, confidence=0.85):
        return {'choice': choice, 'confidence': confidence}

    def _value(self, probs):
        dist = {str(i): p for i, p in enumerate(probs)}
        weighted = sum(i * p for i, p in enumerate(probs))
        return {'probabilities': dist, 'score': weighted, 'confidence': 0.8}

    def test_value_boundary(self):
        self.assertEqual(
            rules.decide_transcription(self._ctype('monologue'),
                                       self._value([0.0, 0.5, 0.5]))['action'],
            'priority_transcribe')
        self.assertEqual(
            rules.decide_transcription(self._ctype('monologue'),
                                       self._value([0.0, 0.501, 0.499]))['action'],
            'skipped')

    def test_non_speech_skips_regardless_of_value(self):
        got = rules.decide_transcription(self._ctype('non_speech'),
                                         self._value([0.1, 0.8, 0.1]))
        self.assertEqual(got, {'action': 'skipped', 'reason': 'non_speech'})

    def test_low_confidence_type_falls_to_legacy(self):
        got = rules.decide_transcription(self._ctype('interview', confidence=0.4),
                                         self._value([0.0, 0.0, 1.0]))
        self.assertEqual(got['action'], 'legacy_pipeline')

    def test_manual_retry_allowed_on_low_value(self):
        got = rules.decide_transcription(self._ctype('discussion'),
                                         self._value([0.9, 0.05, 0.05]))
        self.assertTrue(got['manual_retry_allowed'])


class SameEventRuleTests(unittest.TestCase):
    def test_boundary(self):
        self.assertEqual(rules.decide_same_event({'noul': 0.75})['action'], 'fold')
        self.assertEqual(rules.decide_same_event({'noul': 0.749})['action'], 'keep_separate')

    def test_failure_keeps_separate(self):
        self.assertEqual(rules.decide_same_event(None, request_failed=True)['action'],
                         'keep_separate')


class ResponseValidationTests(unittest.TestCase):
    def test_score_distribution_must_sum_to_one(self):
        with self.assertRaises(ValueError):
            rules.validate_answer('info_density',
                                  {'probabilities': {'0': 0.5, '1': 0.2, '2': 0.1},
                                   'confidence': 0.9})

    def test_score_list_form_rejected(self):
        # Real API returns dict keyed by level index (verified live 2026-09-21).
        with self.assertRaises(ValueError):
            rules.validate_answer('info_density',
                                  {'probabilities': [0.1, 0.2, 0.7], 'confidence': 0.9})

    def test_score_field_out_of_range_rejected(self):
        # API's score is authoritative but must stay within [0, levels-1].
        with self.assertRaises(ValueError):
            rules.validate_answer('info_density',
                                  {'probabilities': {'0': 0.0, '1': 0.0, '2': 1.0},
                                   'score': 2.5, 'confidence': 0.9})

    def test_choice_outside_options_rejected(self):
        with self.assertRaises(ValueError):
            rules.validate_answer('enrichment_tier', {'choice': 'deluxe', 'confidence': 0.9})

    def test_noul_out_of_range_rejected(self):
        with self.assertRaises(ValueError):
            rules.validate_answer('substantial_change', {'noul': 1.5})


class DemoScenarioTests(unittest.TestCase):
    def test_all_demo_cases_pass(self):
        passed, failures = rules.run_demo(verbose=False)
        self.assertEqual(passed, len(rules.DEMO_CASES))
        self.assertEqual(failures, [])


if __name__ == '__main__':
    unittest.main()
