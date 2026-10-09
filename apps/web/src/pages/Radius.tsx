import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowUpRight,BookOpen,ChevronLeft,ChevronRight,Compass,ExternalLink,Loader2,MessageCircle,Plus,RefreshCw,Search} from 'lucide-react';
import {request} from '../lib/api/shared';
import {RadiusOverview} from '../features/radius/RadiusOverview';
import {RadiusChat} from '../features/radius/RadiusChat';
import {RadiusReader} from '../features/radius/RadiusReader';
import {RadiusSources} from '../features/radius/RadiusSources';
import {RadiusTopics} from '../features/radius/RadiusTopics';
import {button,field,dateText,errorText,type Item,type Overview,type RadiusStatus,type ReaderTarget,type SearchResult,type Source,type Topic} from '../features/radius/types';
import '../features/radius/radius.css';

export function Radius(){
  const cache=useQueryClient();
  const [view,setView]=useState<'ask'|'browse'>('ask');
  const [query,setQuery]=useState('');
  const [filters,setFilters]=useState({q:'',topicId:'',sourceId:'',from:'',to:'',sort:'newest',matching:'strict',dateBasis:'published',offset:0});
  const [reader,setReader]=useState<ReaderTarget|null>(null),[articleScope,setArticleScope]=useState<{id:string;title:string}|null>(null);
  const status=useQuery({queryKey:['radius','status'],queryFn:()=>request<{data:RadiusStatus}>('/radius/status'),refetchInterval:60000,retry:false});
  const overview=useQuery({queryKey:['radius','overview'],queryFn:()=>request<{data:Overview}>('/radius/overview'),refetchInterval:60000,retry:false});
  const topics=useQuery({queryKey:['radius','topics'],queryFn:()=>request<{data:Topic[]}>('/radius/topics'),refetchInterval:60000});
  const sources=useQuery({queryKey:['radius','sources'],queryFn:()=>request<{data:Source[]}>('/radius/sources'),refetchInterval:60000});
  const results=useQuery({queryKey:['radius','search',filters],queryFn:()=>request<{data:SearchResult}>('/radius/search',{method:'POST',body:{q:filters.q,...(filters.topicId?{topicId:filters.topicId}:{}),sourceIds:filters.sourceId?[Number(filters.sourceId)]:[],...(filters.from?{from:filters.from}:{}),...(filters.to?{to:filters.to}:{}),sort:filters.sort,matching:filters.matching,dateBasis:filters.dateBasis,offset:filters.offset,limit:20}}),enabled:view==='browse',refetchInterval:60000,retry:false});
  const active=topics.data?.data.find(t=>t.id===filters.topicId),counts=status.data?.data,data=results.data?.data;
  const topicPending=active&&(!counts?.sync?.completed_at||new Date(active.updatedAt)>new Date(counts.sync.started_at));
  function filter(patch:Partial<typeof filters>){setFilters(old=>({...old,...patch,offset:0}));}
  function askArticle(id:string,title:string){setArticleScope({id,title});setView('ask');window.scrollTo({top:0,behavior:'smooth'});}
  function openItem(item:Item){setReader({kind:'article',id:item.id});}
  return <div className="radius-shell">
    <header className="radius-header"><div><div className="radius-kicker"><Compass size={14}/>来自我关注的世界</div><h1>信息半径<span>我的视野，随时可调用。</span></h1></div><a className={button} href="/sources"><Plus size={15}/>管理信源</a></header>
    <div className="radius-subnav"><div className="radius-tabs" role="tablist" aria-label="信息半径功能"><button role="tab" aria-selected={view==='ask'} onClick={()=>setView('ask')}><MessageCircle size={16}/>AI 问答</button><button role="tab" aria-selected={view==='browse'} onClick={()=>setView('browse')}><BookOpen size={16}/>浏览与搜索</button></div><button className="radius-sync" onClick={()=>void cache.invalidateQueries({queryKey:['radius']})} title={counts?.sync?.completed_at?'最近同步：'+new Date(counts.sync.completed_at).toLocaleString('zh-CN'):'刷新同步状态'}><span className={'radius-status-dot '+(counts?.sync?.error?'warning':'')}/>{counts?.sync?.error?'同步待检查':counts?.sync?.completed_at?'已同步':'同步状态待确认'}<RefreshCw size={12}/></button></div>
    <RadiusTopics topics={topics.data?.data||[]} sources={sources.data?.data||[]} active={active} onSelect={id=>{setArticleScope(null);filter({topicId:id});}}/>
    {topicPending&&<p className="radius-inline-notice">主题正在等待下一轮索引更新，约 5 分钟后开始同步。</p>}
    {status.error&&<p role="status" className="radius-notice danger">{errorText(status.error)}</p>}
    <div className={'radius-content-grid '+(view==='browse'?'browsing':'')}>
      <main className="radius-main-panel">
        <div hidden={view!=='ask'}><RadiusChat topic={active} scope={articleScope} onClearScope={()=>setArticleScope(null)} onRead={setReader}/></div>
        {view==='browse'&&<section className="radius-library" aria-label="浏览与搜索">
          <form className="radius-search-bar" onSubmit={e=>{e.preventDefault();filter({q:query,sort:query?'relevance':'newest'});}}><Search size={18}/><label className="sr-only" htmlFor="radius-search">搜索关注源全文</label><input id="radius-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索文章、人物、话题或播客转写…"/><button className="radius-search-submit" type="submit">搜索</button></form>
          <div className="radius-filter-row"><label><span>来源</span><select className={field} value={filters.sourceId} onChange={e=>filter({sourceId:e.target.value})}><option value="">全部信源</option>{sources.data?.data.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label><span>开始</span><input aria-label="开始日期" type="date" className={field} value={filters.from} onChange={e=>filter({from:e.target.value})}/></label><label><span>结束</span><input aria-label="结束日期" type="date" className={field} value={filters.to} onChange={e=>filter({to:e.target.value})}/></label><label><span>排序</span><select className={field} value={filters.sort} onChange={e=>filter({sort:e.target.value})}><option value="relevance">相关度</option><option value="newest">所选日期倒序</option></select></label><label><span>日期依据</span><select className={field} value={filters.dateBasis} onChange={e=>filter({dateBasis:e.target.value})}><option value="published">发布时间</option><option value="received">采集时间</option></select></label><label><span>匹配</span><select aria-label="关键词匹配方式" className={field} value={filters.matching} onChange={e=>filter({matching:e.target.value})}><option value="strict">全部关键词</option><option value="broad">放宽匹配（仅浏览）</option></select></label></div>
          {results.error&&<p role="alert" className="radius-notice danger">{errorText(results.error)}</p>}
          {results.isLoading?<div className="radius-empty" role="status"><Loader2 className="animate-spin"/>正在搜索你的信息半径…</div>:data&&<>
            <p className="radius-muted">{data.matchNote}</p><div className="radius-result-summary"><span>{filters.q?'找到':'已收录'} <strong>{data.total.toLocaleString()}</strong> 篇{active&&' · '+active.name}</span><small>{results.isFetching?'更新中…':`${data.processingTimeMs} ms`}</small></div>
            {!data.items.length&&<div className="radius-empty"><Search size={28}/><h3>这个范围里暂时没有结果</h3><p>换一个关键词、放宽日期，或加入新的关注源。</p></div>}
            <div className="radius-article-list">{data.items.map(item=><article key={item.id} className="radius-article-card"><div className="radius-article-source"><span className="radius-source-avatar">{item.source_name.slice(0,1).toUpperCase()}</span><span>{item.source_name}</span><time>{item.published_at?dateText(item.published_at):'发布日未知 · '+dateText(item.received_at)+' 采集'}</time></div><h2><button onClick={()=>openItem(item)}>{item.title}</button></h2><p>{item.excerpt}</p><div className="radius-article-actions"><span className="radius-body-badge">{item.material_label||'已存资料'}</span>{item.is_filtered&&<span className="radius-quiet-tag">信息流已过滤</span>}<div><button onClick={()=>openItem(item)}><BookOpen size={13}/>阅读</button><button onClick={()=>askArticle(item.id,item.title)} disabled={!item.qa_eligible}><MessageCircle size={13}/>问这篇</button>{item.url&&<a href={item.url} target="_blank" rel="noreferrer" aria-label={'打开原文：'+item.title}><ExternalLink size={13}/></a>}</div></div></article>)}</div>
            <div className="radius-pagination"><button className={button} disabled={!filters.offset} onClick={()=>setFilters({...filters,offset:Math.max(0,filters.offset-20)})}><ChevronLeft size={14}/>上一页</button><span>{Math.floor(filters.offset/20)+1} / {Math.max(1,Math.ceil(data.total/20))}</span><button className={button} disabled={filters.offset+20>=data.total||filters.offset>=10000} onClick={()=>setFilters({...filters,offset:filters.offset+20})}>下一页<ChevronRight size={14}/></button></div>
          </>}
        </section>}
      </main>
      <div className="radius-context-column"><RadiusOverview data={overview.data?.data} status={counts} onSource={id=>{setView('browse');filter({sourceId:String(id)});}}/>{overview.error&&<p className="radius-notice">图表暂不可用：{errorText(overview.error)}</p>}<a href="/sources" className="radius-grow-link"><Compass size={16}/><div><strong>拓展你的视野</strong><span>加入一个值得长期关注的来源</span></div><ArrowUpRight size={16}/></a></div>
    </div>
    <RadiusSources sources={sources.data?.data||[]} onSource={id=>{setView('browse');filter({sourceId:String(id)});window.scrollTo({top:0,behavior:'smooth'});}}/>
    <RadiusReader key={reader?.id||'closed'} target={reader} onClose={()=>setReader(null)} onAsk={askArticle}/>
  </div>;
}
