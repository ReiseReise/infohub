#!/usr/bin/env python3
"""Live API validation for the Jev integration design (docs/41 scenarios 1.2/2.1/4.1/1.4).

Extends the offline demo (jev_design_rules.py) to the real API: sends the 15 synthetic
demo cases to jev-1.13.0 and checks, for each case:
  1. the API accepts our question shapes (noul / choice / score)
  2. real answers pass client-side validation
  3. local decision rules route real answers to a sensible branch

What this still does NOT show (docs/40 §9): accuracy on real editorial material.
The 15 cases are synthetic wiring probes; agreement with mock expectations is a
sanity signal, not an accuracy score.

Budget discipline mirrors the main experiment: per-request reservation written and
fsynced before the call, settlement after, $1 hard cap, process lock, skip on
already-settled case (idempotent rerun). Key comes from TYPESAFE_API_KEY in the
environment; never a CLI argument, never written inside this repo.

Run:
  . ~/.workbuddy/keys/typesafe.env && \
  PYTHONDONTWRITEBYTECODE=1 python3 qa/jev/jev_design_live.py
"""
import fcntl
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import jev_design_rules as rules  # noqa: E402

ROOT = HERE.parents[1]
OUT = ROOT / 'exports' / 'jev-20260921' / 'design-run'
LEDGER = OUT / 'ledger.jsonl'
LOCK = OUT / '.lock'
REPORT = OUT / 'DESIGN_LIVE_REPORT.md'
ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
BUDGET_USD = 1.0
# Jev published rate: $0.042 per 1M input tokens, output free.
RATE_PER_TOKEN = 0.042 / 1_000_000
# Conservative reservation: utf-8 bytes / 3 as token estimate, plus 2048 overhead.
RESERVE_OVERHEAD_BYTES = 2048


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def append_fsync(entry):
    with LEDGER.open('a', encoding='utf-8') as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + '\n')
        fh.flush()
        os.fsync(fh.fileno())


_CASE_BY_MARKER = {'case:' + c['scenario']: c for c in rules.DEMO_CASES}


def _settled_cost(row):
    """Cost of a settled entry; deterministic recomputation for entries written
    before the cost_usd field existed (ledger is append-only, never rewritten)."""
    if 'cost_usd' in row:
        return row['cost_usd']
    case = _CASE_BY_MARKER.get(row['case'])
    if not case:
        return 0.0
    keys = list(case['mock'].keys()) if case['mock'] else ['substantial_change']
    return estimated_cost(rules.build_request(keys, case['state']))


def load_settled():
    settled, failed, cleared, spent = set(), set(), set(), 0.0
    if not LEDGER.exists():
        return settled, failed, spent
    for line in LEDGER.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row['event'] == 'settled':
            settled.add(row['case'])
            spent += _settled_cost(row)
        elif row['event'] == 'failed':
            failed.add(row['case'])
        elif row['event'] == 'review_cleared':
            cleared.add(row['case'])
    return settled, failed - cleared, spent


def estimated_cost(body):
    payload = json.dumps(body, ensure_ascii=False).encode('utf-8')
    tokens = len(payload) / 3 + RESERVE_OVERHEAD_BYTES / 3
    return tokens * RATE_PER_TOKEN


def call_jev(body):
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        ENDPOINT, data=data, method='POST',
        headers={'Authorization': 'Bearer ' + os.environ['TYPESAFE_API_KEY'],
                 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=rules.CLIENT_TIMEOUT_SECONDS) as resp:
        return json.loads(resp.read().decode('utf-8'))


def raw_answer_for(question_key, response):
    """Extract one question's answer from the API response, tolerating both
    {'answers': {key: ...}} and flat {key: ...} envelope shapes."""
    answers = response.get('answers', response) if isinstance(response, dict) else response
    return answers[question_key]


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == '--review-clear':
        # Manual review action: document root cause and unblock a failed case.
        OUT.mkdir(parents=True, exist_ok=True)
        os.chmod(OUT, 0o700)
        append_fsync({'event': 'review_cleared', 'case': sys.argv[2],
                      'reason': sys.argv[3] if len(sys.argv) > 3 else 'reviewed',
                      'ts': now()})
        print('review_cleared appended for %s' % sys.argv[2])
        return 0
    key = os.environ.get('TYPESAFE_API_KEY')
    if not key:
        print('blocked: TYPESAFE_API_KEY not in environment')
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    os.chmod(OUT, 0o700)

    lock_fh = LOCK.open('w')
    try:
        fcntl.flock(lock_fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print('blocked: another process holds the run lock')
        return 2

    settled, failed, spent = load_settled()
    print('Live design-question validation against %s' % rules.MODEL)
    print('Ledger: %s (settled=%d, failed=%d, spent=%.6f USD)\n' % (LEDGER, len(settled), len(failed), spent))

    results = []
    for case in rules.DEMO_CASES:
        name = case['scenario']
        if case.get('request_failed'):
            print('  LOCAL %-30s (fallback-path demo, no API call needed)' % name)
            continue
        marker = 'case:' + name
        if marker in settled:
            print('  SKIP  %-30s (already settled)' % name)
            continue
        if marker in failed:
            print('  HALT  %-30s (prior failure needs manual review)' % name)
            continue

        question_keys = list(case['mock'].keys()) if case['mock'] else ['substantial_change']
        body = rules.build_request(question_keys, case['state'])
        est = estimated_cost(body)
        if spent + est > BUDGET_USD:
            print('  STOP  budget: spent %.6f + est %.6f would exceed %.2f USD' % (spent, est, BUDGET_USD))
            break
        append_fsync({'event': 'reserved', 'case': marker, 'est_usd': round(est, 6), 'ts': now()})

        t0 = time.monotonic()
        try:
            response = call_jev(body)
        except urllib.error.HTTPError as exc:
            append_fsync({'event': 'failed', 'case': marker, 'error': 'http_%d' % exc.code,
                          'detail': exc.read().decode('utf-8', 'replace')[:200], 'ts': now()})
            print('  FAIL  %-30s HTTP %d — stopping for manual review' % (name, exc.code))
            break
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            append_fsync({'event': 'failed', 'case': marker, 'error': 'network',
                          'detail': str(exc)[:200], 'ts': now()})
            print('  FAIL  %-30s network: %s — stopping' % (name, exc))
            break
        elapsed = time.monotonic() - t0

        # validate every real answer through the same strict client checks
        validated, raw_dump = {}, {}
        try:
            for qkey in question_keys:
                raw = raw_answer_for(qkey, response)
                raw_dump[qkey] = raw
                validated[qkey] = rules.validate_answer(qkey, raw)
        except (KeyError, ValueError) as exc:
            append_fsync({'event': 'failed', 'case': marker, 'error': 'invalid_answer',
                          'detail': str(exc)[:200], 'ts': now()})
            print('  FAIL  %-30s answer rejected: %s' % (name, exc))
            break

        # route real answers through the documented decision rules
        fn, _ = case['expect']
        if fn == 'decide_monitor':
            decision = rules.decide_monitor(raw_dump['substantial_change'])
        elif fn == 'decide_enrichment':
            decision = rules.decide_enrichment(raw_dump['enrichment_tier'], raw_dump['info_density'])
        elif fn == 'decide_transcription':
            decision = rules.decide_transcription(raw_dump['content_type'], raw_dump['transcribe_value'])
        else:
            decision = rules.decide_same_event(raw_dump['same_event'])

        agree = (decision == case['expect'][1])
        entry = {'event': 'settled', 'case': marker, 'seconds': round(elapsed, 3),
                 'cost_usd': round(est, 6),
                 'validated': validated, 'decision': decision,
                 'agrees_with_mock': agree, 'ts': now()}
        append_fsync(entry)
        spent += est
        results.append({'case': name, 'validated': validated, 'decision': decision,
                        'agrees': agree, 'seconds': round(elapsed, 3)})
        verdict = 'MATCH' if agree else 'DIFFER'
        print('  OK    %-30s %4.2fs -> %-46s [%s]'
              % (name, elapsed, json.dumps(decision, ensure_ascii=False), verdict))

    # summary report aggregates ALL settled ledger entries, not just this run's,
    # so reruns never lose earlier results. Cost falls back to deterministic
    # recomputation for entries written before the cost_usd field existed.
    settled_rows = []
    if LEDGER.exists():
        for line in LEDGER.read_text().splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get('event') == 'settled':
                settled_rows.append(row)
    total_cost = sum(_settled_cost(r) for r in settled_rows)
    agree_count = sum(1 for r in settled_rows if r.get('agrees_with_mock'))
    lines = ['# Jev 设计问题 live 验证报告', '',
             '- 生成时间：%s' % now(),
             '- 模型：%s（固定版本）' % rules.MODEL,
             '- 样本：15 条合成 demo 场景（41号文档 §1.2/§2.1/§4.1/§1.4 的链路探针），其中 3 条为本地降级路径演示，不发请求',
             '- 累计：%d 条已结算，与 mock 预期动作一致 %d 条，累计估算花费 $%.6f（预算 $%.2f）'
             % (len(settled_rows), agree_count, total_cost, BUDGET_USD),
             '- 结论边界：只验证问题形状、响应校验与规则路由；合成样本不证明编辑判断准确率（40号文档第9节）',
             '- 判为 DIFFER 不是失败：真实模型对合成材料的判断与 mock 预期不同，属于待人工解读的观察值', '']
    for r in settled_rows:
        name = r['case'][len('case:'):] if r['case'].startswith('case:') else r['case']
        lines.append('## %s' % name)
        lines.append('- 真实回答：%s' % json.dumps(r.get('validated', {}), ensure_ascii=False))
        lines.append('- 规则路由：%s' % json.dumps(r.get('decision', {}), ensure_ascii=False))
        lines.append('- 与 mock 预期：%s（耗时 %.2fs，估算 $%.6f）'
                     % ('一致' if r.get('agrees_with_mock') else '不同',
                        r.get('seconds', 0.0), _settled_cost(r)))
        lines.append('')
    REPORT.write_text('\n'.join(lines), encoding='utf-8')
    print('\nLedger settled %d cases total, ~%.6f USD cumulative estimate. Report: %s'
          % (len(settled_rows), total_cost, REPORT))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
