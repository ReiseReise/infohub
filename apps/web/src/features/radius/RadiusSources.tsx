import {Radio,ArrowUpRight} from 'lucide-react';
import {dateText,type Source} from './types';
export function RadiusSources({sources,onSource}:{sources:Source[];onSource:(id:number)=>void}){
 const pending=sources.reduce((n,s)=>n+(s.pending_transcript_count||0),0),undated=sources.reduce((n,s)=>n+(s.undated_count||0),0);
 return <section className="radius-source-health" aria-label="信源与采集覆盖"><header><Radio size={16}/><h2>让关注持续进入半径</h2><a href="/sources">管理信源 <ArrowUpRight size={13}/></a></header>
  <p>网站 / RSS、网页目录、播客和工作流文字沿用同一条采集管道。新增主题会匹配已经收录的内容。</p>
  <div className="radius-health-summary"><span>{sources.length} 个已接入来源</span><span>{pending} 条音视频待转写</span><span>{undated} 条未注明发布时间</span></div>
  <details><summary>查看每个来源的覆盖与缺口</summary><div className="radius-health-list">{sources.map(s=><button key={s.id} onClick={()=>onSource(s.id)}><strong>{s.name}</strong><span>{s.item_count} 条 · {s.source_type==='audio'?`已有转写 ${s.transcript_count||0} 条`:`${s.source_role==='reference'?'参考来源':s.source_role==='radar'?'发现线索':'关注来源'}`}</span><small>最近成功 {dateText(s.last_success_at)} · {s.auto_fetch_enabled?'自动采集':'采集已暂停'}{s.last_outcome==='error'?' · 最近采集失败':''}</small></button>)}</div></details>
  <details><summary>公众号、抖音、即刻、X 怎样进入这里？</summary><p>在「信源管理」添加已有的 RSS / RSSHub 地址，或让 n8n、OpenClaw 输出文字 JSON，再配置自定义接口。需要可用的订阅地址或平台授权；没有配置的账号不会自动接入。</p><p>工作流格式：items 数组，每条提供稳定 id、title、原文 url、content 和 publishedAt。转写应放入 content，并保留原文链接；不要把摘要当作逐字稿。</p><a href="/sources">添加来源 →</a></details>
 </section>;
}
