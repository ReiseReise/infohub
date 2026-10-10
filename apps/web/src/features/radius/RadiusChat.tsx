import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowUp,ArrowUpRight,BookOpen,Check,ChevronDown,History,Loader2,MessageCircle,Plus,Search,SlidersHorizontal,Square,X} from 'lucide-react';
import {request} from '../../lib/api/shared';
import {MarkdownContent} from '../../components/MarkdownContent';
import {radiusAnswerMarkdown} from './answer-format';
import {RadiusEvidence} from './RadiusEvidence';
import {dateText,errorText,type EvidencePlan,type ReaderTarget,type Topic} from './types';

type Detail={run:{id:string;question:string;state:string;reason?:string;spent_micros:number|string;policy?:{radius?:{question:string;keywords:string;matched:number;selected:number;sourceCount:number;from?:string;to?:string;mode?:string;warnings?:string[];groups?:{label:string;from:string;to:string;itemIds:string[]}[]}}};drafts:{id:string;quality:string;markdown:string;payload?:unknown}[];sources:{id:string;title:string;url:string;published_at:string}[];citations:{id:string;source_id:string;quote:string}[];steps:{stage:string;state:string;error?:string}[]};
type Config={modelReady:boolean;modelError?:string;model:string;budgetCny:number;priceReviewExpiresAt?:string};
type Scope={id:string;title:string}|null;
const terminal=new Set(['completed','failed','paused','cancelled','review']);
export function RadiusChat({topic,scope,onClearScope,onRead}:{topic?:Topic;scope:Scope;onClearScope:()=>void;onRead:(target:ReaderTarget)=>void}){
  const cache=useQueryClient();
  const [mode,setMode]=useState<'auto'|'answer'|'compare'>('auto'),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [preview,setPreview]=useState<{fingerprint:string;data:EvidencePlan}|null>(null),[previewBusy,setPreviewBusy]=useState(false);
  const [expandedSources,setExpandedSources]=useState(false);
  const [question,setQuestion]=useState(''),[keywords,setKeywords]=useState(''),[advanced,setAdvanced]=useState(false);
  const [runId,setRunId]=useState<string|null>(()=>new URLSearchParams(window.location.search).get('run'));
  const [submitted,setSubmitted]=useState(''),[previous,setPrevious]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[empty,setEmpty]=useState(false);
  const inputRef=useRef<HTMLTextAreaElement>(null);
  const pending=useRef<{key:string;body:string}|null>(null);
  const config=useQuery({queryKey:['radius','model'],queryFn:()=>request<{data:Config}>('/research/config'),retry:false});
  const history=useQuery({queryKey:['radius','questions'],queryFn:()=>request<{data:{id:string;question:string;state:string;created_at:string}[]}>('/radius/questions'),retry:false});
  const detail=useQuery({queryKey:['radius','answer',runId],queryFn:()=>request<{data:Detail}>('/research/runs/'+runId),enabled:!!runId,retry:false,refetchInterval:query=>{const state=(query.state.data as {data:Detail}|undefined)?.data.run.state;return state&&terminal.has(state)?false:2500;}});
  const answer=detail.data?.data,working=!!runId&&(!answer||!terminal.has(answer.run.state));
  const metadata=answer?.run.policy?.radius;
  const currentQuestion=metadata?.question||submitted||answer?.run.question;
  useEffect(()=>{if(scope){setQuestion('这篇文章的核心观点是什么？有哪些值得关注的细节？');inputRef.current?.focus();}},[scope]);
  function openRun(id:string|null){setRunId(id);setError('');setEmpty(false);const url=new URL(window.location.href);if(id)url.searchParams.set('run',id);else url.searchParams.delete('run');window.history.replaceState(null,'',url.pathname+url.search);}
  function requestBody(){return {question:question.trim(),mode,...(!scope&&from?{from}:{}),...(!scope&&to?{to}:{}),...(keywords.trim()?{keywords:keywords.trim()}:{}),...(!scope&&(previous||metadata?.question)?{previousQuestion:previous||metadata?.question}:{}),...(scope?{itemIds:[scope.id]}:topic?{topicId:topic.id}:{})};}
  async function previewEvidence(){
    setPreviewBusy(true);setError('');const body=requestBody(),fingerprint=JSON.stringify(body);
    try{const result=await request<{data:EvidencePlan}>('/radius/preview',{method:'POST',body});setPreview({fingerprint,data:result.data});}catch(e){setError(errorText(e));}finally{setPreviewBusy(false);}
  }
  async function ask(event:FormEvent){
    event.preventDefault();if(question.trim().length<3||busy||working)return;
    setBusy(true);setError('');setEmpty(false);setExpandedSources(false);setSubmitted(question.trim());
    const body=requestBody();
    const fingerprint=JSON.stringify(body);
    if(pending.current?.body!==fingerprint)pending.current={key:crypto.randomUUID(),body:fingerprint};
    setRunId(null);
    try{
      const result=await request<{data:EvidencePlan&{runId:string|null}}>('/radius/ask',{method:'POST',headers:{'Idempotency-Key':pending.current.key},body});
      if(!result.data.runId){setEmpty(true);setPreview({fingerprint,data:result.data});return;}
      pending.current=null;openRun(result.data.runId);setPrevious(question.trim());setQuestion('');
      await cache.invalidateQueries({queryKey:['radius','questions']});
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  async function cancel(){try{await request('/research/runs/'+runId+'/cancel',{method:'POST'});await detail.refetch();}catch(e){setError(errorText(e));}}
  const examples=['最近腾讯在我关注的信源里，风评如何？','近一个月，AI Agent 的讨论有哪些变化？','我关注的来源里，有哪些 AI 教育实践？'];
  return <section className={'radius-chat '+(runId?'has-answer':'')} aria-label="AI 问答">
    {!runId&&!submitted&&<div className="radius-chat-welcome"><span className="radius-ask-mark"><MessageCircle size={21}/></span><h2>向你的信息半径提问</h2><p>从你关注的文章、播客和讨论里找依据，<br className="hidden sm:block"/>把零散的信息连成一个有出处的回答。</p></div>}
    {(runId||submitted)&&<div className="radius-conversation"><div className="radius-user-message">{currentQuestion||submitted}</div>
      {(busy||working)&&<div className="radius-answer-progress" role="status"><Loader2 size={16} className="animate-spin"/><span>{busy?'正在检索关注源，选择相关材料…':answer?.run.state==='queued'?'材料已就绪，正在等待问答服务…':answer?.drafts.length?'回答已生成，正在核对引用和事实…':'正在阅读材料并整理回答…'}</span>{runId&&<button onClick={()=>void cancel()} aria-label="停止本次问答"><Square size={12}/>停止</button>}</div>}
      {answer?.run.state==='review'&&answer.steps.some(s=>s.state==='review'&&s.error)&&<div className="radius-notice danger" role="status">事实核对尚未通过，以下保留为待修订草稿。<details><summary>查看核对问题</summary>{answer.steps.filter(s=>s.error).map((s,i)=><p key={i}>{s.error}</p>)}</details></div>}
      {metadata?.mode==='compare'&&<div className="radius-period-summary">{metadata.groups?.map(g=><span key={g.label}>{g.label}：{g.from} — {g.to} · {g.itemIds.length} 篇</span>)}</div>}
      {metadata&&<div className="radius-evidence-scope"><Search size={12}/>检索「{metadata.keywords||topic?.name||'指定材料'}」 · 找到 {metadata.matched} 篇 · 参考 {metadata.selected} 篇 / {metadata.sourceCount} 个来源{metadata.from&&<> · {metadata.from} 至 {metadata.to}</>}</div>}
      {detail.error&&<p role="alert" className="radius-notice danger">{errorText(detail.error)}</p>}
      {answer?.drafts.length? <div className="radius-answer" onClick={event=>{const a=(event.target as HTMLElement).closest('a');const href=a?.getAttribute('href');if(href?.startsWith('#radius-evidence-')){event.preventDefault();onRead({kind:'evidence',id:href.slice('#radius-evidence-'.length)});}}}><div className="radius-answer-label"><span className="radius-mini-orbit"/>{working?'回答草稿':answer.run.state==='completed'?<><Check size={13}/>{answer.drafts[0]?.quality==='verified'?'基于资料的回答':'已核对 · 含资料限制'}</>:'回答 · 仍有待核实项'}</div><MarkdownContent content={radiusAnswerMarkdown(answer)} mode="markdown" variant="reader"/>
        <div className="radius-answer-sources"><h3><BookOpen size={14}/>参考来源 <span>{answer.sources.length}</span></h3>{answer.sources.slice(0,expandedSources?answer.sources.length:3).map((s,i)=><button key={s.id} onClick={()=>onRead({kind:'evidence',id:s.id})}><span>{i+1}</span><span>{s.title}<small>{dateText(s.published_at)}</small></span><ArrowUpRight size={14}/></button>)}{answer.sources.length>3&&<button className="radius-more-sources" onClick={()=>setExpandedSources(!expandedSources)}>{expandedSources?'收起来源':`查看其余 ${answer.sources.length-3} 篇来源`}<ChevronDown size={12}/></button>}</div>
        <p className="radius-answer-foot">{Number(answer.run.spent_micros)>0?`本次估算用量 ¥${(Number(answer.run.spent_micros)/1000000).toFixed(3)} · `:''}依据已采集资料，不代表全网观点。</p>
      </div>:null}
      {answer&&terminal.has(answer.run.state)&&!answer.drafts.length&&<p className="radius-notice">{answer.run.reason?errorText(answer.run.reason):'本次还没有形成回答。材料和任务状态已保留。'} <a href={'/research?run='+runId}>查看详情 ↗</a></p>}
      {empty&&<div className="radius-empty"><Search size={24}/><h3>半径里还没有足够的材料</h3><p>试试更具体的公司、人物或主题；也可以展开下方“检索关键词”调整搜索。</p></div>}
    </div>}
    {preview&&preview.fingerprint===JSON.stringify(requestBody())&&<RadiusEvidence plan={preview.data} onRead={onRead}/>}
    <form onSubmit={ask} className="radius-composer">
      {(scope||topic)&&<div className="radius-scope-chip">{scope?'仅问这篇：'+scope.title:'关注主题：'+topic?.name}{scope&&<button type="button" aria-label="清除文章范围" onClick={onClearScope}><X size={12}/></button>}</div>}
      <label className="sr-only" htmlFor="radius-question">向信息半径提问</label><textarea ref={inputRef} id="radius-question" value={question} onChange={e=>setQuestion(e.target.value)} rows={3} maxLength={2000} placeholder={previous?'继续追问，或开始一个新问题…':'最近我关注的世界里，发生了什么？'} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();e.currentTarget.form?.requestSubmit();}}}/>
      <div className="radius-composer-bottom"><button className="radius-text-button" type="button" onClick={()=>setAdvanced(!advanced)}><SlidersHorizontal size={14}/>检索关键词<ChevronDown size={12}/></button><div><button type="button" className="radius-button" disabled={previewBusy||question.trim().length<3||working} onClick={()=>void previewEvidence()}>{previewBusy?<Loader2 size={13} className="animate-spin"/>:<Search size={13}/>}先查资料</button><span className="radius-model-label">{config.data?.data.modelReady?'DeepSeek V4.1 Flash':'模型状态待确认'}</span><button type="submit" className="radius-send" aria-label="发送问题" disabled={busy||working||question.trim().length<3||config.data?.data.modelReady===false}>{busy?<Loader2 className="animate-spin" size={18}/>:<ArrowUp size={20}/>}</button></div></div>
      {advanced&&<div className="radius-question-options"><label>关键词（全部词都需匹配）<input value={keywords} onChange={e=>setKeywords(e.target.value)} placeholder="例如：腾讯 或 Hunyuan"/></label><label>回答方式<select aria-label="回答方式" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="auto">自动判断</option><option value="answer">资料问答</option><option value="compare">前后时段比较</option></select></label><label>发布开始<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>发布结束<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>}
    </form>
    <div className="radius-chat-hint"><span>回答会自动检索并附上出处 · 每次预算上限 ¥{config.data?.data.budgetCny||10}</span>{(runId||previous)&&<button onClick={()=>{openRun(null);setSubmitted('');setPrevious('');setQuestion('');setPreview(null);setFrom('');setTo('');setMode('auto');onClearScope();}} className="radius-text-button"><Plus size={13}/>新问题</button>}</div>
    {config.data?.data.priceReviewExpiresAt&&<p className="radius-muted">模型价格核对有效至 {dateText(config.data.data.priceReviewExpiresAt)}，到期需复核；检索不受影响。</p>}
    {(error||config.error||config.data?.data.modelReady===false)&&<p role="alert" className="radius-notice danger">{error||errorText(config.error||config.data?.data.modelError||'问答模型暂不可用')} <a href="/admin?tab=models&center=models">模型设置 ↗</a></p>}
    {!runId&&!submitted&&<div className="radius-examples">{examples.map(s=><button key={s} onClick={()=>{setQuestion(s);inputRef.current?.focus();}}>{s}<ArrowUpRight size={14}/></button>)}</div>}
    {!!history.data?.data.length&&<details className="radius-question-history"><summary><History size={14}/>最近的提问</summary>{history.data.data.map(r=><button key={r.id} onClick={()=>{openRun(r.id);setSubmitted('');setPrevious(r.question);}}>{r.question}<span>{dateText(r.created_at)}</span></button>)}</details>}
  </section>;
}
