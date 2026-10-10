import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import postgres from '../../services/hub-engine/node_modules/postgres/src/index.js';
import {drizzle} from '../../services/hub-engine/node_modules/drizzle-orm/postgres-js/index.js';
import {Hono} from '../../services/hub-engine/node_modules/hono/dist/index.js';
import {RadiusStore} from '../../services/hub-engine/src/radius/store.js';
import {MeiliClient,INDEX} from '../../services/hub-engine/src/radius/meili.js';
import {syncRadius} from '../../services/hub-engine/src/radius/sync.js';
import {searchInput,topicInput} from '../../services/hub-engine/src/radius/contracts.js';
import {createRadiusRoutes} from '../../services/hub-engine/src/routes/radius.js';
import {signAccessToken} from '../../services/hub-engine/src/lib/auth.js';
const url=process.env.DATABASE_URL||'';
if(url!=='postgres://postgres:radius-qa-only@127.0.0.1:58229/radius_qa'||process.env.MEILI_URL!=='http://127.0.0.1:58230'||process.env.NODE_ENV!=='test')throw Error('isolated_targets_required');
const sql=postgres(url,{max:4}),client=new MeiliClient();
const store=new RadiusStore(drizzle(sql) as never,client);
const user='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const checks:string[]=[];const passed=(label:string)=>{checks.push(label);console.log('PASS '+label);};
try {
  await sql.unsafe(`create schema if not exists hub;
    create table if not exists hub.user_settings(user_id uuid primary key,updated_at timestamptz default now());
    create table if not exists hub.sources(id serial primary key,user_id uuid,name text,status text default 'active',source_type text default 'rss',source_role text default 'normal',trust_score int default 60,auto_fetch_enabled boolean default true,last_fetched_at timestamptz,last_success_at timestamptz,last_outcome text);
    create table if not exists hub.items(id uuid primary key,source_id int,user_id uuid,title text,content text,readability_content text,transcript text,snippet text,author text,url text,original_url text,published_at timestamptz,fetched_at timestamptz default now(),is_filtered boolean default false);`);
  await sql.unsafe(`alter table hub.items add column if not exists source_type text default 'rss';alter table hub.items add column if not exists media_type text;alter table hub.items add column if not exists readability_status text;alter table hub.items add column if not exists media_url text;alter table hub.items add column if not exists audio_status text;alter table hub.items add column if not exists audio_task_id text;alter table hub.items add column if not exists ai_translation text;alter table hub.items add column if not exists ai_summary text;alter table hub.items add column if not exists summary_status text;alter table hub.items add column if not exists translation_status text;`);
  const migration=await readFile(new URL('../../scripts/radius/001-radius.sql',import.meta.url),'utf8');
  await sql.begin(tx=>tx.unsafe(migration.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')));
  await sql`truncate hub.items,hub.sources,hub.user_settings`;
  await sql`insert into hub.sources(id,user_id,name) values(1,${user},'合成：已关注网站'),(2,${other},'另一身份的私有来源') on conflict(id) do nothing`;
  await sql`insert into hub.items(id,source_id,user_id,title,content,url,published_at,is_filtered)
    select md5('radius-fixture-'||n)::uuid,1,${user},'合成资料 '||n,
    case when n=1 then 'needleold 旧资料只在正文提到：AI 陪伴进入社区。'
      when n=2 then 'AI 陪伴的广告推广。'
      when n=3 then 'AI companion 真实使用感受。'
      else '合成全文样本，用于验证全量私有搜索，不是真实资讯。编号 '||n end,
    'https://example.invalid/radius/'||n,'2026-01-01'::timestamptz+n*interval '1 minute',n%2=1
    from generate_series(1,10020) n on conflict(id) do nothing`;
  await sql`insert into hub.items(id,source_id,user_id,title,content,url,published_at) values(md5('private-other')::uuid,2,${other},'secretother','secretother 不应被其他用户找到','https://example.invalid/private',now()) on conflict(id) do nothing`;
  await sql`update hub.items set readability_status='ready',readability_content=${'<h2>合成验证：AI 陪伴的日常使用</h2><p>needleold AI 陪伴进入社区，用户重视连续交流。</p><p>'+('这是一段用于排版验收的正文，保留出处、段落和可核对的依据。'.repeat(8))+'</p><blockquote>材料明确区分事实与推测。</blockquote><ul><li>保留出处。</li></ul>'} where id=md5('radius-fixture-1')::uuid`;
  const topic=await store.save(user,topicInput.parse({name:'陪伴验收 '+Date.now(),terms:['AI 陪伴','AI companion'],exclude:['广告']}));
  await syncRadius(sql as never,client);passed('10,021 documents indexed with real Meilisearch, no editorial filtering');
  const all=await store.search(user,searchInput.parse({}));assert.equal(all.total,10020);passed('complete corpus count and owner scope');
  const old=await store.search(user,searchInput.parse({q:'needleold'}));assert.equal(old.items.length,1);assert.equal(old.items[0].is_filtered,true);assert.match(old.items[0].excerpt,/needleold/);passed('old body-only filtered article remains searchable');
  const topicHits=await store.search(user,searchInput.parse({topicId:topic.id}));assert.equal(topicHits.total,2);passed('topic alternatives and exclusion match history');
  const privateHits=await store.search(user,searchInput.parse({q:'secretother'}));assert.equal(privateHits.total,0);passed('other identity documents are not disclosed');
  const otherId=String((await sql`select id from hub.items where source_id=2`)[0].id);
  await assert.rejects(()=>store.read(user,otherId),/item_not_found/);
  await assert.rejects(()=>store.save(user,topicInput.parse({name:'illegal',terms:['x'],sourceIds:[2]})),/source_scope_denied/);passed('read and topic source authorization');
  // Strict schema: send only editable fields.
  const updated=await store.save(user,topicInput.parse({name:topic.name+' 编辑',terms:topic.terms,exclude:topic.exclude}),topic.id,topic.version);
  await assert.rejects(()=>store.save(user,topicInput.parse({name:'stale',terms:['x']}),topic.id,topic.version),/topic_version_conflict/);assert.equal(updated.version,2);passed('optimistic edits reject stale versions');
  await sql`update hub.items set readability_content='enrichmentlater AI companion 全文补齐。' where id=md5('radius-fixture-4')::uuid`;
  await sql`insert into hub.sources(id,user_id,name) values(3,${user},'合成：以后新增的播客') on conflict(id) do nothing`;
  await sql`insert into hub.items(id,source_id,user_id,title,transcript,url,published_at) values(md5('future-source')::uuid,3,${user},'新播客','AI companion newepisode 新增转写','https://example.invalid/new',now()) on conflict(id) do nothing`;
  await syncRadius(sql as never,client);
  assert.equal((await store.search(user,searchInput.parse({q:'enrichmentlater'}))).total,1);
  assert.equal((await store.search(user,searchInput.parse({topicId:topic.id}))).total,4);passed('late enrichment and new source enter existing topics automatically');
  const reading=await store.read(user,String(old.items[0].id));assert.match(reading.body,/needleold/);assert.equal(reading.url,'https://example.invalid/radius/1');passed('stored original text and provenance');
  const denied=await store.search(user,searchInput.parse({sourceIds:[2]}));assert.equal(denied.total,0);passed('source filter cannot widen authorization');
  const app=new Hono();app.route('/api/radius',createRadiusRoutes(store));
  const token=signAccessToken({userId:user,email:'radius@example.invalid',username:'radius-qa',role:'admin'});
  assert.equal((await app.request('/api/radius/search',{method:'POST',body:'{}'})).status,401);
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  assert.equal((await app.request('/api/radius/search',{method:'POST',headers,body:JSON.stringify({limit:9999})})).status,400);
  const real=await app.request('/api/radius/search',{method:'POST',headers,body:JSON.stringify({q:'needleold'})});assert.equal(real.status,200);assert.equal((await real.json()).data.total,1);passed('real HTTP route auth, validation and search');
  const status=await store.status(user);assert.equal(status.collectedDocuments,10021);assert.equal(status.indexedDocuments,10021);passed('collected and indexed counts agree');
  const failing=new MeiliClient();failing.mutate=async()=>{throw Error('synthetic_sync_failure');};
  await assert.rejects(()=>syncRadius(sql as never,failing),/synthetic_sync_failure/);
  assert.equal((await store.search(user,searchInput.parse({q:'needleold'}))).total,1);passed('failed sync preserves previous searchable data');
  await syncRadius(sql as never,client);
  const filler='用于严格检索验收的正文，其中每一个判断都有原始材料作为依据。'.repeat(10);
  const fixtures=[
    ['strict', 'scoperadius AI 教育 实践 '+filler,'2026-09-15','rss',null],
    ['broad', 'scoperadius AI 其他应用 '+filler,'2026-09-16','rss',null],
    ['unknown', 'scoperadius AI 教育 实践 '+filler,null,'rss',null],
    ['audio', 'scoperadius AI 教育 实践 '+filler,'2026-09-17','audio',null],
    ['previous', 'scoperadius AI 教育 实践 '+filler,'2026-08-15','rss',null],
  ];
  for(const [id,body,published,kind,transcript] of fixtures)await sql`insert into hub.items(id,source_id,user_id,title,content,source_type,transcript,url,published_at,fetched_at) values(md5(${'radius-final-'+id})::uuid,1,${user},${'验收 '+id},${body},${kind},${transcript},${'https://example.invalid/final/'+id},${published}::timestamptz,'2026-10-02'::timestamptz)`;
  await syncRadius(sql as never,client);
  const strict=await store.search(user,searchInput.parse({q:'scoperadius AI 教育 实践',from:'2026-09-01',to:'2026-09-30'}));
  assert.equal(strict.total,2);assert.ok(strict.items.every(x=>x.published_at));passed('strict keyword search does not drop subject terms or invent publication dates');
  assert.ok((await store.search(user,searchInput.parse({q:'scoperadius AI 教育 实践',matching:'broad',from:'2026-09-01',to:'2026-09-30'}))).total>strict.total);passed('broad matching is explicit and separate from strict evidence');
  const received=await store.search(user,searchInput.parse({q:'scoperadius',from:'2026-10-02',to:'2026-10-02',dateBasis:'received'}));assert.equal(received.total,5);passed('collection time can be searched without rewriting publication time');
  const preview=await app.request('/api/radius/preview',{method:'POST',headers,body:JSON.stringify({question:'AI 教育实践有哪些变化？',keywords:'scoperadius AI 教育 实践',from:'2026-09-01',to:'2026-09-30'})});
  assert.equal(preview.status,200);const evidence=(await preview.json()).data;assert.equal(evidence.ready,true);assert.equal(evidence.groups.length,2);assert.equal(evidence.groups[0].selected.length,1);assert.equal(evidence.groups[1].selected.length,1);assert.ok(!evidence.items.some((x:any)=>x.material_kind==='audio_description'));passed('real comparison selects dated quality evidence in both periods without a model call');
  await mkdir('/private/tmp/infohub-radius-qa',{recursive:true});
  await writeFile('/private/tmp/infohub-radius-qa/token',token,{mode:0o600});
  await writeFile('/private/tmp/infohub-radius-qa/result.json',JSON.stringify({checks,documents:10022,userDocuments:10021,oldSearchMs:old.processingTimeMs,topicId:topic.id,index:INDEX},null,2));
  console.log(JSON.stringify({passed:checks.length,oldSearchMs:old.processingTimeMs}));
} finally {await sql.end();}
