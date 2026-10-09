import {questionSearch,comparisonWindow,selectQuestionSources,type AskInput,type Candidate} from './question.js';
import type {RadiusStore} from './store.js';

export type EvidenceItem=Candidate&{title?:unknown;source_name?:unknown;material_label?:unknown;material_kind?:unknown;source_role?:unknown;trust_score?:unknown;excerpt?:unknown};
export async function prepareEvidence(store:Pick<RadiusStore,'search'|'article'>,userId:string,input:AskInput,now=new Date()){
 const search=questionSearch(input,now),comparison=comparisonWindow(input,now);
 const warnings:string[]=['资料来自你关注的来源，收录不代表你已阅读或认同；来源权重不代表事实已核实。'];
 const groups:Array<{label:string;from:string|null;to:string|null;matched:number;eligibleInSample:number;selected:EvidenceItem[]}>=[];
 if(input.itemIds.length){
  const articles=await Promise.all([...new Set(input.itemIds)].map(id=>store.article(userId,id)));
  const selected=selectQuestionSources(articles.filter(x=>x.qa_eligible),12);
  groups.push({label:'指定文章',from:null,to:null,matched:articles.length,eligibleInSample:articles.filter(x=>x.qa_eligible).length,selected});
 }else{
  const searches=comparison?[{label:'前一时段',search:comparison.previous},{label:'当前时段',search:comparison.current}]:[{label:'本次资料',search}];
  for(const part of searches){
   const found=await store.search(userId,part.search);
   const eligible=found.items.filter(x=>x.qa_eligible===true);
   groups.push({label:part.label,from:part.search.from||null,to:part.search.to||null,matched:found.total,eligibleInSample:eligible.length,selected:selectQuestionSources(eligible,comparison?6:12)});
   if(found.total>50)warnings.push(`${part.label}匹配 ${found.total} 条，本次从相关度最高的 50 条中选择；不代表全部来源的观点分布。`);
   if(found.items.some(x=>x.qa_eligible!==true))warnings.push(`${part.label}中的短内容或未转写音视频只作为搜索线索，没有用来生成回答。`);
  }
 }
 const selected=groups.flatMap(g=>g.selected);
 const ready=comparison?groups.every(g=>g.selected.length>0):selected.length>0;
 const reason=ready?null:comparison?'comparison_evidence_missing':'no_evidence';
 if(comparison)warnings.push('两段使用同样长度的时间窗口与严格关键词；数量变化也可能来自采集覆盖变化，不等于态度变化。');
 if(groups.some(g=>g.from||g.to))warnings.push('按发布时间筛选，未注明发布时间的材料不参与时间比较。');
 if(selected.some(x=>x.material_kind==='stored_text'))warnings.push('部分材料为已存文本，完整性尚未核实；结论应限于实际读到的内容。');
 return {ready,reason,keywords:search.q,mode:comparison?'compare':'answer',matching:'strict',
  from:groups.at(-1)?.from,to:groups.at(-1)?.to,matched:groups.reduce((n,g)=>n+g.matched,0),selected:selected.length,
  sourceCount:new Set(selected.map(x=>x.source_id)).size,groups,items:selected,warnings:[...new Set(warnings)]};
}
export function evidenceQuestion(input:AskInput,plan:Awaited<ReturnType<typeof prepareEvidence>>){
 const context=input.previousQuestion?`前一个问题：${input.previousQuestion}\n本次追问：${input.question}`:input.question;
 const scopes=plan.groups.map(g=>`${g.label}：${g.from||'不限开始'} 至 ${g.to||'不限结束'}，匹配 ${g.matched} 条，选用 ${g.selected.length} 条。`).join('\n');
 return `${context}\n\n资料范围：\n${scopes}\n${plan.warnings.join('\n')}\n只使用本次选中且实际读到的材料。${plan.mode==='compare'?'分别说明前后时段的证据、变化与未变化；缺少可比证据时明确无法判断，不用篇数推断赞同率。':'先回答问题，再列必要依据和不确定性。'}不把此前回答作为新证据，不把模型推断写成用户立场。`;
}
