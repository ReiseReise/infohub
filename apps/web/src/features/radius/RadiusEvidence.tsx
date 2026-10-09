import {BookOpen,Search} from 'lucide-react';
import {dateText,type EvidencePlan,type ReaderTarget} from './types';
export function RadiusEvidence({plan,onRead}:{plan:EvidencePlan;onRead:(target:ReaderTarget)=>void}){
 return <section className="radius-evidence-preview" aria-label="问答资料预览"><header><Search size={15}/><strong>先看依据</strong><span>仅检索 · 未调用模型</span></header>
  <p>严格检索「{plan.keywords||'所选主题 / 文章'}」 · {plan.sourceCount} 个来源 · 选用 {plan.selected} 篇</p>
  {!plan.ready&&<p className="radius-notice">{plan.reason==='comparison_evidence_missing'?'前后时段缺少可比较的材料，暂不生成趋势结论。可调整日期，或改为资料问答。':'没有找到足够的可用正文。可调整关键词，或先补齐正文 / 转写。'}</p>}
  <div className="radius-evidence-periods">{plan.groups.map(g=><div key={g.label}><strong>{g.label}</strong><small>{g.from?`${g.from} — ${g.to}`:'未限定日期'} · 匹配 {g.matched} 条 / 选用 {g.selected.length} 篇</small>{g.selected.map(item=><button key={item.id} onClick={()=>onRead({kind:'article',id:item.id})}><BookOpen size={13}/><span>{item.title}<small>{item.source_name} · {dateText(item.published_at)} · {item.material_label}</small></span></button>)}</div>)}</div>
  <details><summary>资料范围与限制</summary><ul>{plan.warnings.map(s=><li key={s}>{s}</li>)}</ul></details>
 </section>;
}
