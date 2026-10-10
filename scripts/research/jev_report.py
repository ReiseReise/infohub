#!/usr/bin/env python3
"""Generate paired report and only create a blind sheet after all 30 pairs exist."""
import argparse
from collections import Counter
from decimal import Decimal
import hashlib
import html
import json
import math
from pathlib import Path
import statistics
from jev_experiment import VIEWS, load_public, save


def percentile(values, quantile):
    values=sorted(values)
    return values[math.ceil(len(values)*quantile)-1] if values else None


def report(rows, directory):
    path=directory/'ledger.jsonl'
    records=[json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
    latest={r['call_id']:r for r in records}
    public={(r['sample_id'],r['arm']):r for r in latest.values() if r['phase']=='public'}
    successes={key:r for key,r in public.items() if r['status']=='succeeded'}
    metrics={}
    for arm in ('jev','baseline'):
        for language in ('zh','en','all'):
            entries=[r for (_,a),r in public.items() if a==arm and (language=='all' or r['language']==language)]
            ok=[r for r in entries if r['status']=='succeeded']; times=[r['latency_ms'] for r in ok]
            metrics[arm+'/'+language]={'attempted':len(entries),'success':len(ok),
                'failed_or_uncertain':len(entries)-len(ok),'p50_ms':statistics.median(times) if times else None,
                'p95_ms':percentile(times,.95),'input_tokens':sum(r['result']['usage']['input_tokens'] for r in ok),
                'output_tokens':sum(r['result']['usage']['output_tokens'] for r in ok),
                'cost_upper_estimate_usd':str(sum((Decimal(r.get('settled_usd',r['reserved_usd'])) for r in entries),Decimal(0)))}
    paired=all((r['id'],a) in successes for r in rows for a in ('jev','baseline')) and len(rows)==30
    ranks={}
    for arm in ('jev','baseline'):
        available=[r for r in rows if (r['id'],arm) in successes]
        def score(row):
            answers=successes[row['id'],arm]['result']['answers']
            return sum(answers[v]['score'] for v in VIEWS)/3
        # Ranks within an arm only; never compare the raw 0–4 and 0–100 scales.
        ranks[arm]={r['id']:i+1 for i,r in enumerate(sorted(available,key=lambda r:(-score(r),r['id'])))}
    comparison=[]
    for row in rows:
        item={k:row[k] for k in ('id','title','url','language','category')}
        for arm in ('jev','baseline'):
            result=public.get((row['id'],arm))
            item[arm]={'status':result['status'] if result else 'not_called',
                       'rank':ranks[arm].get(row['id'])}
        item['rank_difference']=abs(item['jev']['rank']-item['baseline']['rank']) if paired else None
        comparison.append(item)
    blind_path=directory/'blind-review.json'
    if paired and not blind_path.exists():
        first=sorted(comparison,key=lambda r:(-r['rank_difference'],r['id']))[:5]
        remaining=[r for r in comparison if r not in first]
        second=sorted(remaining,key=lambda r:hashlib.sha256(('jev-review-v1'+r['id']).encode()).hexdigest())[:5]
        chosen=sorted(first+second,key=lambda r:hashlib.sha256(('jev-blind-order-v1'+r['id']).encode()).hexdigest())
        lookup={r['id']:r for r in rows}
        sheet=[{'review_id':f'R{i+1:02}', 'title':r['title'],'url':r['url'],
                'text':lookup[r['id']]['text'],'label':None,'comment':''} for i,r in enumerate(chosen)]
        save(blind_path,sheet)
        save(directory/'blind-key.json',{f'R{i+1:02}':r['id'] for i,r in enumerate(chosen)})
    decision={'recommendation':('继续：补齐 Jev 对照，暂不扩大或接入生产' if not paired else '等待人工盲审反馈'),
              'quality_verified':False,'human_reviews':0}
    if paired and blind_path.exists():
        labels=json.loads(blind_path.read_text());key=json.loads((directory/'blind-key.json').read_text())
        blind_lines=['# 10 条资讯盲审','',
                     '先阅读本页，再看模型对照报告，以免排名影响判断。',
                     '每条只需判断：值得读 / 一般 / 不值得读。可以直接在对话回复，例如“R01 值得读，R02 一般”。',
                     '下方摘录均来自冻结原文，不是模型摘要；完整正文可展开。这里不显示模型身份、分数或挑选原因。','']
        for item in labels:
            title=html.escape(item['title']).replace('[','（').replace(']','）')
            blind_lines.extend([f"## {item['review_id']} · {title}", '', f"[原文链接]({item['url']})", '',
                                '> '+html.escape(' '.join(item['text'].split())[:280])+'…', '',
                                '<details><summary>展开完整冻结正文</summary>', '',
                                '<pre>'+html.escape(item['text'])+'</pre>', '</details>', '',
                                f"判断：{item.get('label') or '待填写'}", ''])
        (directory/'BLIND_REVIEW.md').write_text('\n'.join(blind_lines)+'\n')
        (directory/'BLIND_REVIEW.md').chmod(0o600)
        if (len(labels)==10 and {x['review_id'] for x in labels}==set(key)
                and all(x.get('label') in ('值得读','一般','不值得读') for x in labels)):
            missed={arm:sum(x['label']=='值得读' and ranks[arm][key[x['review_id']]]>10 for x in labels) for arm in ranks}
            readworthy=sum(x['label']=='值得读' for x in labels)
            j,b=metrics['jev/all']['p50_ms'],metrics['baseline/all']['p50_ms']
            faster=bool(b and j<=b*.7)
            decision.update(human_reviews=10,missed_readworthy_in_reviewed_sample=missed,
                            readworthy_review_count=readworthy,
                            latency_improved_30_percent=faster,
                            recommendation='建议扩大正式评测' if readworthy and missed['jev']<=missed['baseline'] and faster else '调整或停止扩量',
                            quality_verified=False)
    phases={name:json.loads((directory/(name+'-status.json')).read_text())
            for name in ('smoke','public') if (directory/(name+'-status.json')).exists()}
    failures=[{k:r.get(k) for k in ('phase','arm','sample_id','status','error_type','http_status','bridge_error_type')}
              for r in latest.values() if r['status']!='succeeded']
    result={'paired_30_complete':paired,'metrics':metrics,'comparison':comparison,'decision':decision,
            'phase_status':phases,'failures_or_uncertain_calls':failures,
            'actual_invoice_usd':None,'total_accounted_upper_estimate_usd':str(sum((Decimal(r.get('settled_usd',r['reserved_usd'])) for r in latest.values()),Decimal(0))),
            'cost_note':'Reservation/settlement use conservative rates; not actual invoices or savings evidence.',
            'rank_note':'Equal weight three public views; top 10 is the exploratory selection cutoff. Partial ranks are not paired rankings.'}
    if paired:
        j,b=metrics['jev/all']['p50_ms'],metrics['baseline/all']['p50_ms']
        result['latency_comparison']={'median_speedup':b/j if j else None,
                                      'median_reduction_percent':100*(1-j/b) if b else None,
                                      'scope':'This paired experiment only; includes client/network overhead; no quality-equivalence claim'}
    save(directory/'comparison.json',result)
    lines=['# Jev 首轮实验报告','',f"建议：{decision['recommendation']}。",'',
           f"冻结公开样本：{len(rows)}；完整双模型配对：{'是' if paired else '否'}；人工反馈：{decision['human_reviews']}/10。",
           '未完成双模型配对时，不生成虚假的分歧排名或盲审样本。','',
           '| 组别 | 已尝试 | 成功 | P50 ms | P95 ms | 费用上界估算 USD |',
           '|---|---:|---:|---:|---:|---:|']
    for name,m in metrics.items():
        lines.append(f"| {name} | {m['attempted']} | {m['success']} | {m['p50_ms']} | {m['p95_ms']} | {m['cost_upper_estimate_usd']} |")
    if paired:
        timing=result['latency_comparison']
        lines+=['',f"本次实验中位耗时减少 {timing['median_reduction_percent']:.1f}%，约 {timing['median_speedup']:.1f} 倍速度差。包含客户端/网络开销；不代表同等质量，更不是生产日报整体加速倍数。"]
    lines+=['','费用为保守单价计算的上界估算，未核对实际账单；不能据此认定成本下降。',
            '基线复用当前 Qwen Plus 和公开默认标准，将三视角合并为一次实验调用；不是原生产调度的耗时复刻。',
            '样本按类别选取，来源分布不均，只有10条选择性盲审；结果只用于决定是否扩大实验。','',
            '| 文章 | 语言/类别 | Jev | 基线 | 排名差 |','|---|---|---|---|---|']
    for r in comparison:
        title=r['title'].replace('|','／').replace('[','（').replace(']','）')
        j=f"第{r['jev']['rank']}名" if paired else r['jev']['status']
        b=f"第{r['baseline']['rank']}名" if paired else r['baseline']['status']
        lines.append(f"| [{title}]({r['url']}) | {r['language']}/{r['category']} | {j} | {b} | {r['rank_difference']} |")
    lines+=['','## 阻塞与失败','']
    for phase,status in phases.items():
        lines.append(f"- {phase}: {status['status']}; blockers: {', '.join(status.get('blocked',[])) or 'none'}")
    for failure in failures:
        lines.append('- '+json.dumps(failure,ensure_ascii=False))
    lines+=['','## 下一步','']
    if paired:
        lines+=['[完成 10 条盲审](BLIND_REVIEW.md)，每条选择值得读、一般或不值得读。',
                '模型调用已完成，不再为本轮重复付费；在人工反馈前不扩大样本、不接入生产。']
    else:
        lines+=['配置本机 TYPESAFE_API_KEY 后，先完成 8 条合成接口验证并检查语义结果，再补跑同一冻结样本的 Jev 组。',
                '有 failed/reserved 记录时先核对请求和账单，不覆盖、删除或自动重新发起。',
                '两组30条齐全后生成10条盲审单；未有人类标签前，不作质量或收益采纳结论。']
    (directory/'REPORT.md').write_text('\n'.join(lines)+'\n');(directory/'REPORT.md').chmod(0o600)
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cases',type=Path,required=True)
    p.add_argument('--output-root',type=Path,required=True);a=p.parse_args()
    result=report(load_public(a.cases),a.output_root)
    print(json.dumps({'paired_30_complete':result['paired_30_complete'],'decision':result['decision']},ensure_ascii=False))
