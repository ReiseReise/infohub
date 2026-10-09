import copy
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/research'))
import jev_experiment as e
import jev_report as report_module
from jev_freeze import plain


def response(public=False):
    choices=e.smoke.QUESTIONS['topic']['criteria']
    answers={'relevant':{'type':'noul','noul':.9},'sufficient':{'type':'noul','noul':.9},
             'topic':{'type':'choice','choice':'technology','confidence':.9,
                      'probabilities':{k:float(k=='technology') for k in choices}}}
    if public:
        for name in e.VIEWS:
            answers[name]={'type':'score','score':3.,'confidence':.9,
                           'probabilities':{str(i):float(i==3) for i in range(5)}}
    return {'model':e.MODEL,'answers':answers,'usage':{'input_tokens':100,'output_tokens':30}}


def public_row(i=0):
    text='An article about an AI application with concrete evidence. '*10+str(i)
    return {'id':str(i),'kind':'public','language':'en','category':'application','title':'Article '+str(i),
            'text':text,'source':'Test public source','url':f'https://techcrunch.com/test/{i}',
            'published_at':'2026-09-20T12:00:00Z','content_sha256':hashlib.sha256(text.encode()).hexdigest(),
            'event_key':'event-'+str(i),'completeness':{'status':'body_present'},
            'public_access':{'status':'verified','evidence_sha256':'abc','checked_at':'2026-09-21'}}


class ExperimentTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        self.rows=e.smoke.load_cases(ROOT/'qa/jev/synthetic-cases.jsonl')
    def tearDown(self):self.tmp.cleanup()

    def test_offline_does_not_probe_or_call(self):
        with patch.object(e,'jev_call',side_effect=AssertionError),patch.object(e,'baseline_bridge',side_effect=AssertionError):
            r=e.run(self.rows,'smoke',['jev'],self.root)
        self.assertEqual(r['calls'],0);self.assertFalse((self.root/'ledger.jsonl').exists())

    def test_secret_and_label_whitelist(self):
        row=public_row();row.update(secret='SENTINEL',old_score=100,label='must_read')
        for arm in ('jev','baseline'):
            body=e.smoke.encoded(e.request_for(row,arm,'public')).decode()
            self.assertNotIn('SENTINEL',body);self.assertNotIn('old_score',body)

    def test_budget_exhaustion_prevents_reservation(self):
        j=e.Journal(self.root)
        try:
            with self.assertRaisesRegex(ValueError,'budget_exhausted'):j.reserve('a',Decimal('1.01'),{})
            self.assertEqual(j.used(),0)
        finally:j.close()

    def test_inflight_survives_restart_blocks_another_call(self):
        j=e.Journal(self.root);j.reserve('a',Decimal('.1'),{});j.close()
        j=e.Journal(self.root)
        try:
            self.assertEqual(j.used(),Decimal('.1'))
            with self.assertRaisesRegex(ValueError,'unresolved'):j.reserve('b',Decimal('.1'),{})
        finally:j.close()

    def test_per_request_persistence_and_resume(self):
        calls=[]
        def fake(body):
            calls.append(1)
            if len(calls)>1:
                entries=[json.loads(s) for s in (self.root/'ledger.jsonl').read_text().splitlines()]
                self.assertTrue(any(x['status']=='succeeded' for x in entries))
            return response()
        e.run(self.rows,'smoke',['jev'],self.root,True,{'jev':fake})
        e.run(self.rows,'smoke',['jev'],self.root,True,{'jev':fake})
        self.assertEqual(len(calls),8)

    def test_failed_call_redacted_and_not_retried(self):
        calls=[]
        def fake(body):calls.append(1);raise RuntimeError('SECRET_VALUE')
        a=e.run(self.rows,'smoke',['jev'],self.root,True,{'jev':fake})
        b=e.run(self.rows,'smoke',['jev'],self.root,True,{'jev':fake})
        self.assertEqual(len(calls),1);self.assertEqual(a['status'],'stopped');self.assertEqual(b['status'],'stopped')
        self.assertNotIn('SECRET_VALUE',(self.root/'ledger.jsonl').read_text())

    def test_changed_input_cannot_reuse_run(self):
        e.run(self.rows,'smoke',['jev'],self.root,True,{'jev':lambda body:response()})
        changed=copy.deepcopy(self.rows);changed[0]['text']+='changed'
        with self.assertRaisesRegex(ValueError,'manifest_changed'):
            e.run(changed,'smoke',['jev'],self.root,True,{'jev':lambda body:response()})

    def test_score_must_match_distribution(self):
        raw=response(True);raw['answers']['ai_industry']['score']=1
        with self.assertRaisesRegex(ValueError,'expectation'):e.validate(raw,'jev','public')

    def test_public_hash_and_duplicate_validation(self):
        p=self.root/'cases.jsonl';row=public_row()
        p.write_text(json.dumps(row)+'\n');self.assertEqual(len(e.load_public(p)),1)
        row['text']+='changed';p.write_text(json.dumps(row)+'\n')
        with self.assertRaisesRegex(ValueError,'hash'):e.load_public(p)
        row=public_row();p.write_text((json.dumps(row)+'\n')*2)
        with self.assertRaisesRegex(ValueError,'duplicate'):e.load_public(p)

    def test_public_access_required(self):
        row=public_row();row['public_access']['status']='unverified';p=self.root/'cases.jsonl'
        p.write_text(json.dumps(row))
        with self.assertRaisesRegex(ValueError,'access'):e.load_public(p)

    def test_incomplete_report_never_fabricates_blind_review(self):
        r=report_module.report([public_row(i) for i in range(30)],self.root)
        self.assertFalse(r['paired_30_complete']);self.assertFalse((self.root/'blind-review.json').exists())
        self.assertTrue(all(x['rank_difference'] is None for x in r['comparison']))

    def test_complete_pairs_produce_ten_blind_items_and_preserve_labels(self):
        rows=[public_row(i) for i in range(30)];j=e.Journal(self.root)
        try:
            for row in rows:
                for arm in ('jev','baseline'):
                    j.append({'call_id':row['id']+arm,'phase':'public','arm':arm,'sample_id':row['id'],
                              'language':'en','status':'succeeded','latency_ms':100 if arm=='jev' else 1000,
                              'reserved_usd':'.001','settled_usd':'.0001',
                              'result':{'answers':{v:{'score':int(row['id']) if arm=='jev' else 30-int(row['id'])} for v in e.VIEWS},
                                        'usage':{'input_tokens':10,'output_tokens':10}}})
        finally:j.close()
        report_module.report(rows,self.root);p=self.root/'blind-review.json';sheet=json.loads(p.read_text())
        self.assertEqual(len(sheet),10)
        self.assertEqual(len({s['review_id'] for s in sheet}),10)
        self.assertNotIn('baseline',p.read_text());self.assertNotIn('rank_difference',p.read_text())
        sheet[0]['label']='值得读';p.write_text(json.dumps(sheet));before=p.read_bytes()
        r=report_module.report(rows,self.root)
        self.assertEqual(p.read_bytes(),before);self.assertFalse(r['decision']['quality_verified'])

    def test_markdown_and_html_normalize_same_visible_words(self):
        self.assertEqual(plain('Read [this](https://example.com).'),plain('Read <a href="https://example.com">this</a>.'))

    def test_concurrent_lock_rejected(self):
        first=e.Journal(self.root)
        try:
            with self.assertRaises(BlockingIOError):e.Journal(self.root)
        finally:first.close()

    def test_budget_bound_violation_stops(self):
        calls=[]
        def fake(body):
            calls.append(1);r=response();r['usage']['input_tokens']=99999999;return r
        result=e.run(self.rows,'smoke',['jev'],self.root,True,{'jev':fake})
        self.assertEqual(result['status'],'stopped');self.assertEqual(len(calls),1)
        self.assertIn('budget_bound_violation',(self.root/'ledger.jsonl').read_text())

    def test_interrupt_keeps_reservation(self):
        def fake(body):raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            e.run(self.rows,'smoke',['jev'],self.root,True,{'jev':fake})
        records=[json.loads(s) for s in (self.root/'ledger.jsonl').read_text().splitlines()]
        self.assertEqual(len(records),1);self.assertEqual(records[0]['status'],'reserved')
        result=e.run(self.rows,'smoke',['jev'],self.root,True,{'jev':lambda body:response()})
        self.assertEqual(result['calls'],0)

    def test_live_missing_key_records_block_without_request(self):
        with patch.dict(e.os.environ,{},clear=True),patch.object(e,'jev_call',side_effect=AssertionError):
            r=e.run(self.rows,'smoke',['jev'],self.root,True)
        self.assertEqual(r['calls'],0);self.assertIn('missing_TYPESAFE_API_KEY',r['blocked'])

    def test_public_jev_requires_smoke(self):
        with patch.dict(e.os.environ,{'TYPESAFE_API_KEY':'dummy'}),patch.object(e,'jev_call',side_effect=AssertionError):
            r=e.run([public_row()],'public',['jev'],self.root,True)
        self.assertEqual(r['calls'],0);self.assertIn('complete_smoke_first',r['blocked'])

    def test_baseline_truncation_is_failure(self):
        with self.assertRaisesRegex(ValueError,'truncation'):
            e.validate({'finish_reason':'length'},'baseline','public')


if __name__=='__main__':unittest.main()
