import type {Draft} from '../research/contracts.js';
export const RADIUS_ANSWER_RULES='这是一条面向读者的半径问答。analysis 最多3条、每条不超过320字，先直接回答问题；facts 最多6条、每条不超过240字，只保留支撑结论的关键事实；unresolved 最多4条、每条不超过240字。不要列逐篇目录、引用核对过程或重复问题。text 只写自然语言，引用ID仅放入 citations 数组。每条事实注明必要的主体与归属；不同文章不能未经证据建立引用或因果关系。区分报道时间与事件时间、尝试与成功、来源声称与独立验证。遇数字排版残缺或范围含糊时省略具体数值并明确限制，禁止猜测补全。跨时段结论限定在本次选材中，不宣称代表总体舆论。';
export function radiusDraftIssues(draft:Draft,citationIds:string[]){
 const errors:string[]=[];
 if(draft.facts.length>6||draft.analysis.length>3||draft.unresolved.length>4||draft.facts.some(x=>x.text.length>240)||draft.analysis.some(x=>x.text.length>320)||draft.unresolved.some(x=>x.length>240))errors.push('radius_answer_needs_concision');
 if([...draft.facts,...draft.analysis].some(x=>citationIds.some(id=>x.text.includes(id))))errors.push('radius_citation_ids_belong_in_citations_only');
 return errors;
}
