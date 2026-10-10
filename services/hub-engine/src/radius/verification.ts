import {z} from 'zod';
import type {Draft} from '../research/contracts.js';
export const RADIUS_VERIFY_RULES='逐条核对 draft.facts、draft.analysis、draft.unresolved，每条恰好给出一个检查结果，index 从0开始。只调用 submit_verification，返回 checks 数组，不返回 pass 或 issues。verdict 选择 matches_evidence（与已给材料一致）、contradicts_evidence（存在具体矛盾）、not_supported（证据不能支持）、stated_limit（仅用于明确承认局限的 unresolved）。引用绑定由条目的 citations 数组与 evidence.citationId 完成，绝不要求 text 写入引用ID。一个段落可由 citations 数组中多个来源分别支持；通过材料标题和引文核对对应关系。准确归属为报道或自述的陈述，应核对“来源确实这样说”，不能因缺少第二来源便判为错误；自述不能升级成独立验证。等值数字与单位换算不能当作矛盾。contradicts_evidence 或 not_supported 必须在 reason 中写明具体主张和不一致点；通过项的说明不作为阻断问题。';
const check=z.object({section:z.enum(['facts','analysis','unresolved']),index:z.number().int().min(0),verdict:z.enum(['matches_evidence','contradicts_evidence','not_supported','stated_limit']),reason:z.string().min(1).max(1500)}).strict();
export function parseRadiusVerification(value:unknown,draft:Draft){
 const parsed=z.object({checks:z.array(check).min(1).max(20)}).strict().parse(value),seen=new Set<string>();
 for(const row of parsed.checks){
  const key=row.section+':'+row.index;
  if(row.index>=draft[row.section].length||seen.has(key))throw Error('verification_duplicate_or_unknown_entry');
  if(row.verdict==='stated_limit'&&row.section!=='unresolved')throw Error('verification_fact_cannot_be_downgraded_to_limit');
  seen.add(key);
 }
 for(const section of ['facts','analysis','unresolved'] as const)for(let i=0;i<draft[section].length;i++)if(!seen.has(section+':'+i))throw Error('verification_entry_missing');
 const issues=parsed.checks.filter(x=>x.verdict==='contradicts_evidence'||x.verdict==='not_supported').map(x=>`${x.section}[${x.index}]: ${x.reason}`);
 return{pass:issues.length===0,issues,checks:parsed.checks};
}
