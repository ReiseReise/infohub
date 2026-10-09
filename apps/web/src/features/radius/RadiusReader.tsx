import {useMemo,useState,type CSSProperties} from 'react';
import {useQuery} from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import {X,ExternalLink,MessageCircle,Type,Loader2} from 'lucide-react';
import {MarkdownContent} from '../../components/MarkdownContent';
import {htmlToReadableMarkdown,looksLikeHtmlFragment,plainTextToReadableMarkdown,isUsableDisplayTranslation} from '../../lib/readable-content';
import {loadReaderPreferences,saveReaderPreferences,readerFontFamilyCss,type ReaderPreferences} from '../../lib/reader-preferences';
import {request} from '../../lib/api/shared';
import {button,dateText,errorText,type ReaderTarget} from './types';
type Article={id:string;item_id?:string;title:string;source_name?:string;author?:string;published_at?:string;url?:string;content?:string;body?:string;ai_translation?:string;translation_status?:string;transcript?:string;material_kind?:string;material_label?:string;qa_eligible?:boolean;audio_status?:string};
export function RadiusReader({target,onClose,onAsk}:{target:ReaderTarget|null;onClose:()=>void;onAsk:(id:string,title:string)=>void}){
  const [actionMessage,setActionMessage]=useState(''),[actionBusy,setActionBusy]=useState(false);
  const [tab,setTab]=useState<'original'|'translation'>('original');
  const [prefs,setPrefs]=useState(loadReaderPreferences);
  const query=useQuery({queryKey:['radius','article',target],enabled:!!target,queryFn:()=>request<{data:Article}>(target!.kind==='article'?`/radius/articles/${target!.id}`:`/research/evidence/${target!.id}`)});
  const article=query.data?.data;
  const original=useMemo(()=>{const raw=article?.transcript||article?.content||article?.body||'';return looksLikeHtmlFragment(raw)?htmlToReadableMarkdown(raw):plainTextToReadableMarkdown(raw);},[article]);
  const translation=article?.ai_translation&&isUsableDisplayTranslation(article.ai_translation,original)?article.ai_translation:null;
  function preference<K extends keyof ReaderPreferences>(key:K,value:ReaderPreferences[K]){setPrefs(current=>saveReaderPreferences({...current,[key]:value}));}
  const itemId=target?.kind==='article'?target.id:article?.item_id;
  async function transcribe(){
    if(!itemId||!window.confirm('将使用已配置的音频服务转写这一期，可能按当前服务配置产生费用。是否继续？'))return;
    setActionBusy(true);setActionMessage('');
    try{await request('/items/'+itemId+'/audio-transcribe',{method:'POST'});setActionMessage('转写任务已提交，完成后会自动进入信息半径。');await query.refetch();}catch(e){setActionMessage(errorText(e));}finally{setActionBusy(false);}
  }
  return <Dialog.Root open={!!target} onOpenChange={open=>{if(!open){onClose();setTab('original');}}}><Dialog.Portal><Dialog.Overlay className="radius-reader-overlay"/><Dialog.Content aria-describedby={undefined} className="radius-reader-dialog"><div className="radius-reader-toolbar"><span className="radius-kicker">信息半径 / 阅读</span><div><a className={button} href={article?.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/>原文</a><button className="radius-icon-button" aria-label="关闭阅读" onClick={()=>{onClose();setTab('original');}}><X size={20}/></button></div></div>
    {query.isLoading?<div className="radius-reader-loading"><Loader2 className="animate-spin"/>正在打开原文…</div>:query.error?<p role="alert">{errorText(query.error)}</p>:article&&<div className="radius-reader-scroll"><article className="radius-reader-article" style={{maxWidth:prefs.width,'--reader-font-size':`${prefs.fontSize}px`,'--reader-line-height':String(prefs.lineHeight),'--reader-font-family':readerFontFamilyCss(prefs.fontFamily)} as CSSProperties}>
      <div className="radius-kicker">{article.source_name||'引用来源'}</div><Dialog.Title className="radius-reader-title">{article.title}</Dialog.Title><p className="radius-reader-meta">{article.author&&<span>{article.author}</span>}<span>{dateText(article.published_at)}</span><span>{article.material_label||'已保存的证据快照'}</span></p>
      <div className="radius-reader-controls"><div className="radius-segmented"><button className={tab==='original'||!translation?'active':''} onClick={()=>setTab('original')}>原文</button><button disabled={!translation} className={tab==='translation'&&translation?'active':''} onClick={()=>setTab('translation')}>{translation?'译文':'暂无译文'}</button></div><label><Type size={14}/><span className="sr-only">正文字号</span><select aria-label="正文字号" value={prefs.fontSize} onChange={e=>preference('fontSize',Number(e.target.value) as ReaderPreferences['fontSize'])}>{[16,17,18,20].map(n=><option key={n} value={n}>{n}px</option>)}</select></label>{itemId&&article.qa_eligible!==false&&<button className="radius-text-button" onClick={()=>{onAsk(itemId,article.title);onClose();}}><MessageCircle size={14}/>问这篇</button>}</div>
      {article.material_kind==='audio_description'&&<div className="radius-notice">当前只有节目简介，尚不能据此回答节目内容。<button className={button} disabled={actionBusy||['pending','processing'].includes(article.audio_status||'')} onClick={()=>void transcribe()}>{actionBusy?'正在提交…':['pending','processing'].includes(article.audio_status||'')?'转写进行中':'转写这一期'}</button></div>}
      {article.qa_eligible===false&&article.material_kind!=='audio_description'&&<p className="radius-notice">当前保存的是短内容，只作为线索。可打开原文查看完整内容。</p>}
      {actionMessage&&<p role="status" className="radius-notice">{actionMessage}</p>}
      <MarkdownContent content={tab==='translation'&&translation?translation:original} mode="markdown" variant="reader"/>
      <footer className="radius-reader-end">已读至材料末尾 · <a href={article.url} target="_blank" rel="noreferrer">查看原始页面 ↗</a></footer>
    </article></div>}
    {!article&&<Dialog.Title className="sr-only">阅读原文</Dialog.Title>}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
