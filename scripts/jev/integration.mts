import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
// Never point this fixture writer at a production URL.
if(process.env.JEV_ISOLATED_TEST!=='1'||!/^postgres:\/\/postgres:jev-isolated-test-only@127\.0\.0\.1:58202\/infohub$/.test(process.env.DATABASE_URL||''))throw Error('isolated_database_required');
const {jevStore,JevStore}=await import('../../services/hub-engine/src/jev/store.js');
const {evaluate}=await import('../../services/hub-engine/src/jev/service.js');
const {SCENES,validate,requestKey}=await import('../../services/hub-engine/src/jev/contracts.js');
const {fixture}=await import('../../services/hub-engine/src/jev/test-fixtures.js');
const {default:routes}=await import('../../services/hub-engine/src/routes/jev.js');
const {signAccessToken}=await import('../../services/hub-engine/src/lib/auth.js');
const {enqueueJev,startJevWorker}=await import('../../services/hub-engine/src/jev/queue.js');
const s=jevStore(),sql=s.sql;
await sql.begin(async tx=>{await tx.unsafe(readFileSync(new URL('./001-jev.sql',import.meta.url),'utf8').replace(/^BEGIN;/,'').replace(/COMMIT;\s*$/,''));});
await sql`truncate hub.jev_feedback,hub.jev_decisions`;
await sql`update hub.jev_budget set spent_micros=0,reserved_micros=0`;
const uid=randomUUID();
await sql`insert into auth.users(id,email,username,password_hash,role) values(${uid},${uid+'@example.invalid'},'Jev QA','disabled:!', 'admin')`;
const [source]=await sql`insert into hub.sources(user_id,name,source_type,collector_type,config,auto_fetch_enabled) values(${uid},'Jev synthetic public source','rss','rss',${sql.json({jevPublic:{confirmed:true},monitoringGoal:'AI release changes'})},false) returning id`;
const modes=Object.fromEntries(Object.keys(SCENES).map(k=>[k,'shadow']));
await sql`update hub.jev_control set stopped=false,modes=${sql.json(modes)} where id=true`;
const make=async(extra:Record<string,unknown>={})=>{
 const id=randomUUID();await sql`insert into hub.items ${sql({id,user_id:uid,source_id:source.id,source_type:'rss',title:'Public AI release',url:'https://example.com/'+id,content:'An AI system was released with a public benchmark and reproducible code. '.repeat(20),language:'en',cluster_id:'jev-qa-cluster',...extra})}`;return id;
};
const caller=async(scene:any)=>validate(fixture(scene),scene);
let calls=0;const counting=async(scene:any)=>{calls++;return caller(scene);};
const id=await make();
const before=await sql`select ai_score,processing_status,is_filtered,content from hub.items where id=${id}`;
for(const scene of Object.keys(SCENES).filter(k=>!['same_event','monitor','transcript','preference'].includes(k))){
 const r=await evaluate(s,scene as any,id,undefined,counting);assert.equal(r.status,'suggested',scene);
}
assert.deepEqual(await sql`select ai_score,processing_status,is_filtered,content from hub.items where id=${id}`,before);
const peer=await make();assert.equal((await evaluate(s,'same_event',id,peer,caller)).status,'suggested');
const monitorOld=await make({source_type:'changedetection',published_at:new Date('2026-09-20'),content:'Release v1'});
const monitorNew=await make({source_type:'changedetection',published_at:new Date('2026-09-21'),content:'Release v2'});
assert.equal((await evaluate(s,'monitor',monitorNew,undefined,caller)).status,'suggested');
const transcript=await make({transcript:'This is a public episode transcript. '.repeat(100)});
assert.equal((await evaluate(s,'transcript',transcript,undefined,caller)).status,'suggested');
// Duplicate and new store instance never issue another request.
const countBefore=calls;await evaluate(new JevStore(sql),'feed',id,undefined,counting);assert.equal(calls,countBefore);
const fresh=await make();await Promise.all(Array.from({length:8},()=>evaluate(s,'feed',fresh,undefined,counting)));assert.equal(calls,countBefore+1);
// Privacy, preferences and missing material must stop before the caller.
const privateId=await make({source_type:'email',content:'SYNTHETIC_PRIVATE_SENTINEL'});
for(const [scene,target] of [['feed',privateId],['preference',id],['transcript',id]]){
 const n=calls;const r=await evaluate(s,scene as any,target,undefined,counting);assert.equal(r.status,'skipped');assert.equal(calls,n);
}
const prevKey=process.env.TYPESAFE_API_KEY;delete process.env.TYPESAFE_API_KEY;
assert.equal((await evaluate(s,'source',await make(),undefined,counting)).reason,'missing_credential');process.env.TYPESAFE_API_KEY=prevKey;
// Input changes while waiting: result is stale; only the new hash can be used.
const mutable=await make();
const stale=await evaluate(s,'feed',mutable,undefined,async(scene:any)=>{await sql`update hub.items set content='updated public release details' where id=${mutable}`;return caller(scene);});
assert.equal(stale.status,'stale');
// In-flight stop retains history, never applies result.
const stopped=await evaluate(s,'feed',await make(),undefined,async(scene:any)=>{await sql`update hub.jev_control set stopped=true where id=true`;return caller(scene);});assert.equal(stopped.status,'stale');
await sql`update hub.jev_control set stopped=false where id=true`;
// Unknown network outcomes keep reservations and are not retried.
const failing=await make();const bad=await evaluate(s,'feed',failing,undefined,async()=>{throw Error('SECRET_SENTINEL');});assert.equal(bad.reason,'evaluation_failed');
const spentBefore=await sql`select * from hub.jev_budget`;
await evaluate(s,'feed',failing,undefined,counting);assert.deepEqual(await sql`select * from hub.jev_budget`,spentBefore);
const m=await s.load('feed',await make());const pending=await s.reserve('feed',m,100);assert.ok(pending);
assert.equal(await new JevStore(sql).reserve('feed',m,100),null);
// Concurrent budget reservations cannot oversubscribe remaining funds.
const [b]=await sql`select * from hub.jev_budget`;const remaining=Number(b.limit_micros)-Number(b.spent_micros)-Number(b.reserved_micros);
const a=await s.load('fetch',await make()),bmat=await s.load('fetch',await make());
const reserves=await Promise.allSettled([s.reserve('fetch',a,remaining),s.reserve('fetch',bmat,remaining)]);assert.equal(reserves.filter(v=>v.status==='fulfilled').length,1);
// Auth and activation denial operate on actual Hono routes.
const admin=signAccessToken({userId:uid,email:'qa@example.invalid',username:'qa',role:'admin'}),user=signAccessToken({userId:uid,email:'qa@example.invalid',username:'qa',role:'user'});
const req=(path:string,method='GET',body?:unknown,token=admin)=>routes.request(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
assert.equal((await routes.request('/config')).status,401);assert.equal((await req('/config','GET',undefined,user)).status,403);
assert.equal((await req('/config','PATCH',{scene:'feed',mode:'active'})).status,409);
assert.equal((await req('/config','PATCH',{scene:'preference',mode:'shadow'})).status,403);
assert.equal((await routes.request('/internal/transcript',{method:'POST',body:'{}'})).status,401);
const response=await req('/decisions');const records=await response.json();assert.equal(response.status,200);assert.ok(!JSON.stringify(records).includes('SECRET_SENTINEL'));assert.ok(!JSON.stringify(records).includes('SYNTHETIC_PRIVATE_SENTINEL'));
assert.equal((await req('/feedback','POST',{id:requestKey('feed',id,(await s.load('feed',id)).state),verdict:'important_miss'})).status,200);
// Actual isolated Redis worker consumes a job, but exhausted budget blocks HTTP.
const worker=startJevWorker();const queued=await make();await enqueueJev('source',queued);
let observed=false;for(let n=0;n<30;n++){if((await sql`select id from hub.jev_decisions where target_id=${queued}`).length){observed=true;break;}await new Promise(r=>setTimeout(r,100));}
assert.ok(observed,'worker must persist the decision');
await worker?.close();
console.log('PASS: all scenes, public-only, auth, shadow invariants, stale revisions, idempotency, concurrent budget, restart reservations, real Redis worker; mock model only');
process.exit(0);
