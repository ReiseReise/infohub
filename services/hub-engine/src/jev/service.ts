import { config } from '../config/index.js';
import { callJev, payload } from './client.js';
import { decide, reserveMicros, PRICE_USD_PER_MTOK, type Scene } from './contracts.js';
import { JevStore } from './store.js';
import { logAiUsage } from '../lib/ai-usage.js';
const safeReasons=new Set(['public_content_required','privacy_blocked','item_not_found','transcript_missing','peer_required','not_cluster_candidates','not_monitor_item','previous_snapshot_missing','monitoring_goal_required','missing_credential','budget_exhausted','scene_disabled','request_unknown','invalid_response','rate_limited','provider_failed','circuit_open','global_disabled']);
export function safeReason(e:unknown){const v=e instanceof Error?e.message:'';return safeReasons.has(v)?v:'evaluation_failed';}
export async function evaluate(store:JevStore,scene:Scene,target:string,peer?:string,caller=callJev){
 let id:string|null=null;
 try {
  if(!config.ai.enabled)throw Error('global_disabled');
  const control=await store.control();if(!control||control.stopped||control.modes[scene]!=='shadow')throw Error('scene_disabled');
  const material=await store.load(scene,target,peer);
  const key=process.env.TYPESAFE_API_KEY||'';if(!key)throw Error('missing_credential');
  const failures=await store.sql`select id from hub.jev_decisions where status in ('unknown','reserved') and created_at>now()-interval '10 minutes' limit 3`;
  if(failures.length>=3)throw Error('circuit_open');
  id=await store.reserve(scene,material,reserveMicros(payload(scene,material.state)));
  if(!id)return {status:'duplicate'};
  const started=Date.now();const result=await caller(scene,material.state,key);
  let stale=true;try{stale=(await store.load(scene,target,peer)).revision!==material.revision;}catch{/* material revoked */}
  const c=await store.control();stale=stale||c.stopped||c.modes[scene]!=='shadow';
  const suggestion=decide(scene,result),cost=Math.ceil(result.usage.input_tokens*PRICE_USD_PER_MTOK);
  await store.settle(id,cost,result.usage.input_tokens,Date.now()-started,suggestion,stale);
  await logAiUsage({userId:material.userId,sceneType:`jev.${scene}`,status:stale?'stale':'success',provider:'typesafe',modelName:result.model,targetType:'item',targetId:target,inputTokens:result.usage.input_tokens,outputTokens:result.usage.output_tokens,estimatedCost:cost/1e6,latencyMs:Date.now()-started,apiKind:'systemone'}).catch(()=>{});
  return {id,status:stale?'stale':'suggested',suggestion};
 }catch(e){const reason=safeReason(e);if(id)await store.fail(id,reason);else await store.skip(scene,target,reason);return {status:id?'unknown':'skipped',reason};}
}
