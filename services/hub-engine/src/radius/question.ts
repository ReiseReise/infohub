import {z} from 'zod';
import {searchInput} from './contracts.js';
import {canonicalKey} from './material.js';
export const askInput=z.object({
  question:z.string().trim().min(3).max(2000),keywords:z.string().trim().max(200).optional(),previousQuestion:z.string().trim().max(2000).optional(),
  topicId:z.string().uuid().optional(),sourceIds:z.array(z.number().int().positive()).max(200).default([]),
  from:z.string().optional(),to:z.string().optional(),itemIds:z.array(z.string().uuid()).max(16).default([]),
  mode:z.enum(['auto','answer','compare']).default('auto'),
}).strict();
export type AskInput=z.infer<typeof askInput>;
const TEMPORAL=/(?:最近|过去|近)\s*(?:\d+|[一二两三四五六七八九十半]+)\s*(?:个)?\s*(?:月|周|星期|天|年)|上个月|上个星期|上周|上月|去年|今年|本月|这个月|本周|这周|今天|昨天|最近|近期|最新/g;
const STOP=new Set('的 了 是 在 对 有 和 与 我 我们 你 他们 哪些 什么 怎么 怎样 如何 吗 呢 吧 里 里面 这个 这些 那个 它 其 以及 关于 有没有 是否 为什么 请 帮我 看看 介绍 总结 分析 评价 变化 趋势 风评 舆论 态度 讨论 观点 看法 分歧 案例 进展 信息 半径 哈勃 关注 信源 订阅 来源 内容 文章 人 说 说了 谈 什么样 大家 主要 有哪些 帮 新 还 哪里 哪 一下 一个 上个 有什么 怎么样 相比 以前 之前 前后 对比 比较'.split(' '));
const SEGMENTER=new Intl.Segmenter('zh',{granularity:'word'});
export function questionKeywords(question:string):string{
 const tokens:string[]=[];let single='';const flush=()=>{if(single){tokens.push(single);single='';}};
 for(const part of SEGMENTER.segment(question.normalize('NFKC').replace(TEMPORAL,' '))){
  const word=part.segment;if(!part.isWordLike||STOP.has(word)){flush();continue;}
  if(/^[\p{Script=Han}]$/u.test(word)){single+=word;continue;}flush();tokens.push(word);
 }flush();return [...new Set(tokens.filter(x=>!STOP.has(x)&&!/^\d+$/.test(x)&&(x.length>1||/^[A-Za-z]$/.test(x))))].slice(0,8).join(' ');
}
const DAY=86400000;
const iso=(n:number)=>new Date(n).toISOString().slice(0,10);
function numberWord(s:string){const map:Record<string,number>={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};if(/^\d+$/.test(s))return +s;if(s.includes('十')){const[a,b]=s.split('十');return (map[a]||1)*10+(map[b]||0);}return map[s];}
export function questionWindow(question:string,now=new Date()):{from?:string;to?:string}{
 const today=Date.parse(iso(now.getTime()+8*3600000)+'T00:00:00Z'),d=new Date(today),y=d.getUTCFullYear(),m=d.getUTCMonth();
 if(/上个月|上月/.test(question))return{from:iso(Date.UTC(y,m-1,1)),to:iso(Date.UTC(y,m,0))};
 if(/本月|这个月/.test(question))return{from:iso(Date.UTC(y,m,1)),to:iso(today)};
 if(/去年/.test(question))return{from:iso(Date.UTC(y-1,0,1)),to:iso(Date.UTC(y-1,11,31))};
 if(/今年/.test(question))return{from:iso(Date.UTC(y,0,1)),to:iso(today)};
 const monday=today-((d.getUTCDay()+6)%7)*DAY;
 if(/上周|上个星期/.test(question))return{from:iso(monday-7*DAY),to:iso(monday-DAY)};
 if(/本周|这周/.test(question))return{from:iso(monday),to:iso(today)};
 if(/昨天/.test(question))return{from:iso(today-DAY),to:iso(today-DAY)};
 if(/今天/.test(question))return{from:iso(today),to:iso(today)};
 const explicit=question.match(/(?:最近|过去|近)?\s*(\d{1,3}|[一二两三四五六七八九十]+)\s*个?\s*(天|周|星期|月|年)/);
 let days=explicit?numberWord(explicit[1])*({天:1,周:7,星期:7,月:30,年:365}[explicit[2]]||1):undefined;
 if(/半年/.test(question))days=180;
 if(!days&&/最近|近期|最新/.test(question))days=30;
 if(!days)return{};days=Math.min(730,Math.max(1,days));return{from:iso(today-(days-1)*DAY),to:iso(today)};
}
export function questionSearch(input:AskInput,now=new Date()){
 const window=questionWindow(input.question,now);
 const q=input.keywords?.trim()||questionKeywords(input.question)||questionKeywords(input.previousQuestion||'');
 const contextual=!input.keywords&&input.previousQuestion&&/^(那|它|他们|这些|这件|为什么|还有)/.test(input.question)?questionKeywords(input.previousQuestion)+' '+q:q;
 return searchInput.parse({q:[...new Set(contextual.split(/\s+/))].join(' ').trim(),topicId:input.topicId,sourceIds:input.sourceIds,
  from:input.from||window.from,to:input.to||window.to,limit:50,matching:'strict',dateBasis:'published',sort:'relevance'});
}
export function comparisonWindow(input:AskInput,now=new Date()){
 if(input.itemIds.length||input.mode==='answer'||(input.mode==='auto'&&!/变化|趋势|相比|对比|前后|风向/.test(input.question)))return null;
 let current=questionSearch(input,now);
 if(!current.from||!current.to)current={...current,...questionWindow('最近30天',now)};
 const start=Date.parse(current.from!+'T00:00:00Z'),end=Date.parse(current.to!+'T00:00:00Z'),span=end-start+DAY;
 return{current,previous:{...current,from:iso(start-span),to:iso(start-DAY)}};
}
export type Candidate={id:string;source_id?:unknown;content_basis?:unknown;qa_eligible?:unknown;canonical_url?:unknown;url?:unknown;content_hash?:unknown;body_hash?:unknown;published_at?:unknown};
export function selectQuestionSources<T extends Candidate>(items:T[],limit=12,seen=new Set<string>()):T[]{
 const eligible=items.filter(x=>x.qa_eligible===true||(x.qa_eligible===undefined&&x.content_basis==='body'));
 const unique:T[]=[],candidatesSeen=new Set(seen);
 const keysFor=(item:T)=>[canonicalKey(item.canonical_url||item.url),item.body_hash?String(item.body_hash):item.content_hash?String(item.content_hash):''].filter(Boolean);
 for(const item of eligible){const keys=keysFor(item);if(keys.some(k=>candidatesSeen.has(k)))continue;keys.forEach(k=>candidatesSeen.add(k));unique.push(item);}
 const selected:T[]=[],counts=new Map<unknown,number>();
 const remember=(item:T)=>{selected.push(item);keysFor(item).forEach(k=>seen.add(k));};
 for(const item of unique){const n=counts.get(item.source_id)||0;if(n>=3)continue;remember(item);counts.set(item.source_id,n+1);if(selected.length===limit)return selected;}
 for(const item of unique)if(!selected.some(s=>s.id===item.id)&&selected.length<limit)remember(item);
 return selected;
}
