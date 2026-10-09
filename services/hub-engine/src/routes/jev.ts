import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { timingSafeEqual } from 'node:crypto';
import { requireAuth } from '../lib/auth.js';
import { config } from '../config/index.js';
import { jevStore } from '../jev/store.js';
import { SCENES,isScene } from '../jev/contracts.js';
import { enqueueJev } from '../jev/queue.js';
const app=new Hono();
app.post('/internal/transcript',async c=>{
 const given=Buffer.from(c.req.header('X-Internal-Key')||''),expected=Buffer.from(process.env.INTERNAL_API_KEY||'');
 if(!expected.length||given.length!==expected.length||!timingSafeEqual(given,expected))return c.json({error:'unauthorized'},401);
 const b=await c.req.json().catch(()=>null);if(!b||typeof b.itemId!=='string')return c.json({error:'item_required'},400);
 await enqueueJev('transcript',b.itemId);return c.json({status:'queued_or_disabled'});
});
app.use('*',async(c,next)=>{const u=requireAuth(c);if(u.role!=='admin')return c.json({error:'admin_required'},403);await next();});
app.onError((e,c)=>e instanceof HTTPException?c.json({error:'unauthorized'},e.status):c.json({error:e.message==='public_content_required'?'public_content_required':'jev_unavailable'},503));
app.get('/config',async c=>{
 const s=jevStore();const control=await s.control();const [budget]=await s.sql`select * from hub.jev_budget where id='jev-20260922'`;
 return c.json({control,budget,scenes:SCENES,workerEnabled:process.env.JEV_ENABLED==='true',globalEnabled:config.ai.enabled,credentialReady:Boolean(process.env.TYPESAFE_API_KEY),applicationEnabled:false});
});
app.patch('/config',async c=>{
 const b=await c.req.json().catch(()=>null);if(!b||typeof b!=='object')return c.json({error:'invalid_config'},400);
 const s=jevStore();
 if(b.stopped!==undefined&&typeof b.stopped!=='boolean')return c.json({error:'invalid_config'},400);
 if(b.scene!==undefined&&(!isScene(b.scene)||!['off','shadow'].includes(b.mode)))return c.json({error:'acceptance_required_no_active_mode'},409);
 if(b.scene==='preference'&&b.mode!=='off')return c.json({error:'privacy_blocked'},403);
 await s.sql.begin(async tx=>{
  const sql=tx as unknown as typeof s.sql;const [old]=await sql`select * from hub.jev_control where id=true for update`;
  const modes={...old.modes};if(b.scene)modes[b.scene]=b.mode;
  if(b.disableAll===true)for(const k of Object.keys(SCENES))modes[k]='off';
  await sql`update hub.jev_control set modes=${sql.json(modes)},stopped=${b.stopped??old.stopped},updated_at=now() where id=true`;
 });return c.json({ok:true});
});
app.get('/decisions',async c=>{
 const target=c.req.query('target')||null;const scene=c.req.query('scene')||null;
 const rows=await jevStore().sql`select d.*,i.title,i.url,i.ai_score as original_score from hub.jev_decisions d left join hub.items i on i.id::text=d.target_id where (${target}::text is null or d.target_id=${target}) and (${scene}::text is null or d.scene=${scene}) order by d.created_at desc limit 200`;
 // Verify revisions when reading too: an old valid suggestion is not current evidence.
 const store=jevStore();const data=await Promise.all(rows.map(async row=>{
  if(row.status==='suggested'){try{if((await store.load(row.scene,row.target_id,row.peer_id||undefined)).revision!==row.revision)row.status='stale';}catch{row.status='stale';}}
  return row;
 }));return c.json({data});
});
app.post('/evaluate',async c=>{
 const b=await c.req.json().catch(()=>null);if(!b||!isScene(b.scene)||typeof b.target!=='string'||(b.peer!==undefined&&typeof b.peer!=='string'))return c.json({error:'invalid_request'},400);
 if(b.scene==='preference')return c.json({error:'privacy_blocked'},403);
 const result=await enqueueJev(b.scene,b.target,b.peer);return c.json(result);
});
app.post('/sources/:id/evaluate',async c=>{
 const id=Number(c.req.param('id'));if(!Number.isSafeInteger(id)||id<1)return c.json({error:'invalid_source'},400);
 const rows=await jevStore().sql`select id from hub.items where source_id=${id} order by published_at desc nulls last limit 20`;
 for(const row of rows)await enqueueJev('source',row.id);
 return c.json({sampleCount:rows.length,status:'queued_or_disabled'});
});
app.get('/sources',async c=>c.json({data:await jevStore().sql`select id,name,config->'jevPublic' as public_attestation from hub.sources order by id`}));
app.patch('/sources/:id/public',async c=>{
 const b=await c.req.json().catch(()=>null),id=Number(c.req.param('id'));
 if(!b||typeof b.confirmed!=='boolean'||!Number.isSafeInteger(id)||id<1)return c.json({error:'invalid_request'},400);
 const s=jevStore();const attestation={confirmed:b.confirmed,basis:'administrator_verified_public_source',at:new Date().toISOString()};
 await s.sql`update hub.sources set config=jsonb_set(coalesce(config,'{}'::jsonb),'{jevPublic}',${s.sql.json(attestation)}) where id=${id}`;
 return c.json({ok:true});
});
app.post('/feedback',async c=>{
 const b=await c.req.json().catch(()=>null);if(!b||typeof b.id!=='string'||!['agree','disagree','important_miss'].includes(b.verdict))return c.json({error:'invalid_feedback'},400);
 const s=jevStore();await s.sql`insert into hub.jev_feedback(decision_id,verdict) values(${b.id},${b.verdict})`;
 if(b.verdict==='important_miss')await s.sql`update hub.jev_acceptance set approved=false where scene=(select scene from hub.jev_decisions where id=${b.id})`;
 return c.json({ok:true});
});

app.patch('/items/:id/public',async c=>{
 const b=await c.req.json().catch(()=>null);if(!b||typeof b.confirmed!=='boolean')return c.json({error:'invalid_request'},400);
 const s=jevStore();await s.sql`update hub.items set curation_meta=jsonb_set(coalesce(curation_meta,'{}'::jsonb),'{jevPublic}',${s.sql.json({confirmed:b.confirmed,basis:'administrator_verified_public_item',at:new Date().toISOString()})}) where id::text=${c.req.param('id')}`;
 return c.json({ok:true});
});
app.post('/batch',async c=>{
 const b=await c.req.json().catch(()=>null);if(!b||!isScene(b.scene)||b.scene==='preference')return c.json({error:'invalid_scene'},400);
 const sql=jevStore().sql;
 const rows=await sql`select id from hub.items where coalesce(is_filtered,false)=false order by published_at desc nulls last limit 30`;
 let queued=0;
 for(const row of rows){
  if(b.scene==='same_event'){
   const peers=await sql`select b.id from hub.items a join hub.items b on a.cluster_id=b.cluster_id and a.id<>b.id where a.id=${row.id} order by b.published_at desc limit 3`;
   for(const peer of peers)if((await enqueueJev(b.scene,row.id,peer.id)).queued)queued++;
  }else if((await enqueueJev(b.scene,row.id)).queued)queued++;
 }
 return c.json({queued,candidateCount:rows.length});
});
app.get('/source-report',async c=>{
 const data=await jevStore().sql`select s.id,s.name,count(d.id)::int as evaluated,count(d.id) filter(where d.status='suggested')::int as succeeded,avg((d.suggestion->>'quality')::float) filter(where d.status='suggested') as mean_quality from hub.sources s join hub.items i on i.source_id=s.id join hub.jev_decisions d on d.target_id=i.id::text and d.scene='source' group by s.id,s.name order by s.id`;
 return c.json({data});
});


app.post('/capture/confirm',async c=>{
 const b=await c.req.json().catch(()=>null);if(!b||typeof b.id!=='string')return c.json({error:'decision_required'},400);
 const store=jevStore(),sql=store.sql;
 const [d]=await sql`select * from hub.jev_decisions where id=${b.id} and scene='capture' and status='suggested'`;
 if(!d||!['news','knowledge','hold'].includes(d.suggestion?.action))return c.json({error:'current_capture_suggestion_required'},409);
 const material=await store.load('capture',d.target_id);if(material.revision!==d.revision)return c.json({error:'stale_suggestion'},409);
 await sql`update hub.items set curation_meta=jsonb_set(coalesce(curation_meta,'{}'::jsonb),'{captureRouting}',${sql.json({destination:d.suggestion.action,confirmedAt:new Date().toISOString(),decisionId:d.id})}) where id::text=${d.target_id}`;
 return c.json({ok:true,destination:d.suggestion.action,message:'已确认整理去处；不会自动导出到知识中枢'});
});

export default app;
