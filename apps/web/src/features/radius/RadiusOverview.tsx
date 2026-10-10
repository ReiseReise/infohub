import {useState} from 'react';
import {Area,AreaChart,ResponsiveContainer,Tooltip,XAxis} from 'recharts';
import {ArrowUpRight,Library,Radio,FileCheck2} from 'lucide-react';
import type {Overview,RadiusStatus} from './types';
const colors=['#0f766e','#2d9b91','#6bb6a9','#a5cec1','#d3e4db'];
export function RadiusOverview({data,status,onSource}:{data?:Overview;status?:RadiusStatus;onSource:(id:number)=>void}){
  const [chartNow]=useState(()=>Date.now());
  const total=data?.coverage.total||0,full=data?.coverage.extracted_count||0;
  const ratio=total?full/total:0;
  const top=[...(data?.sources||[])].sort((a,b)=>b.item_count-a.item_count).slice(0,5);
  const captured=new Map((data?.timeline||[]).map(row=>[row.day,row.count]));
  const rows=Array.from({length:30},(_,i)=>{const day=new Date(chartNow+(8*60*60*1000)-(29-i)*86400000).toISOString().slice(0,10);return {day,count:captured.get(day)||0};});
  return <aside className="radius-overview" aria-label="信息半径概览">
    <div className="radius-overview-title"><span>视野概览</span><span className="radius-live-dot">持续积累</span></div>
    <div className="radius-total"><Library size={17}/><strong>{status?.indexedDocuments.toLocaleString()??'—'}</strong><span>篇可检索内容</span></div>
    <div className="radius-growth"><div className="radius-section-label">近 30 天采集 <strong>+{data?.coverage.recent_count.toLocaleString()??'—'}</strong></div><div style={{height:116,width:'100%',minWidth:0}}>
      {rows.length?<ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} margin={{top:14,right:0,bottom:0,left:0}}><defs><linearGradient id="radius-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f766e" stopOpacity={0.26}/><stop offset="100%" stopColor="#0f766e" stopOpacity={0.01}/></linearGradient></defs><XAxis dataKey="day" axisLine={false} tickLine={false} minTickGap={70} tick={{fontSize:10,fill:'#87938e'}} tickFormatter={v=>String(v).slice(5)}/><Tooltip labelFormatter={label=>String(label)} formatter={value=>[value,'采集篇数']} contentStyle={{border:'1px solid #e5eae7',borderRadius:12,fontSize:12}}/><Area type="monotone" dataKey="count" stroke="#168577" strokeWidth={2} fill="url(#radius-area)" isAnimationActive={false}/></AreaChart></ResponsiveContainer>:<p className="radius-muted">暂无最近 30 天的数据</p>}
    </div></div>
    <div className="radius-coverage"><svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`正文提取覆盖率 ${(ratio*100).toFixed(1)}%`}><circle cx="44" cy="44" r="35" fill="none" stroke="#e8eeea" strokeWidth="6"/><circle cx="44" cy="44" r="35" fill="none" stroke="#1c897b" strokeWidth="6" strokeDasharray={`${ratio*219.91} 219.91`} strokeLinecap="round" transform="rotate(-90 44 44)"/><text x="44" y="49" textAnchor="middle" fill="#174a41" fontSize="16" fontWeight="600">{total?(ratio*100).toFixed(1):'—'}%</text></svg><div><p><FileCheck2 size={14}/>正文已提取</p><strong>{full.toLocaleString()} <span>/ {total.toLocaleString()} 篇</span></strong><small>已取到较完整的正文文本</small></div></div>
    <div className="radius-source-graphic"><div className="radius-section-label"><span><Radio size={14}/>信源分布</span><span>{status?.sourceCount??'—'} 个来源</span></div><div className="radius-stacked-bar" aria-hidden="true">{top.map((s,i)=><span key={s.id} style={{width:`${total?s.item_count/total*100:0}%`,background:colors[i]}}/>)}</div>
      {top.map((s,i)=><button key={s.id} className="radius-source-row" onClick={()=>onSource(s.id)}><i style={{background:colors[i]}}/><span>{s.name}</span><small>{s.item_count.toLocaleString()}</small><ArrowUpRight size={12}/></button>)}
    </div>
    <div className="radius-data-gaps"><span>已有转写 <strong>{data?.coverage.transcript_count||0}</strong></span><span>待转写 <strong>{data?.coverage.pending_transcript_count||0}</strong></span><span>短内容 <strong>{data?.coverage.short_count||0}</strong></span><span>发布日未知 <strong>{total-(data?.coverage.dated_count||0)}</strong></span></div>
    <p className="radius-overview-foot">图表来自已采集资料。关注不等于已读，也不等于认同。</p>
  </aside>;
}
