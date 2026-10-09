import assert from 'node:assert/strict';
import test from 'node:test';
import { documentFromRow, MeiliClient, MeiliError } from './meili.js';
import { searchInput, topicInput, plainText, safeUrl } from './contracts.js';
const row = {id:'00000000-0000-4000-8000-000000000001',user_id:'reader',source_id:1,source_name:'我的订阅',title:'未读文章',content:'<p>AI 陪伴进入社区。</p>',transcript:'播客里提到 companion 的应用。'.repeat(10),is_filtered:true,fetched_at:'2026-09-01T00:00:00Z',url:'https://example.org/article'};
test('fulltext document preserves filtered material and additional audio transcript, with provenance',()=>{
  const doc=documentFromRow(row,[], 'generation');
  assert.match(doc.content_text,/AI 陪伴/);assert.match(doc.content_text,/companion/);
  assert.equal(doc.is_filtered,true);assert.equal(doc.canonical_url,row.url);assert.equal(doc.owner_id,'reader');
  assert.equal(doc.content_hash.length,64);assert.equal(doc.content_basis,'body');
});
test('topic membership handles alternatives, exclusions, source restriction and archive',()=>{
  const base={...topicInput.parse({name:'陪伴',terms:['AI 陪伴','companion']}),id:'t',version:1,createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'};
  assert.deepEqual(documentFromRow(row,[base],'g').topic_ids,['t']);
  for(const change of [{exclude:['社区']},{sourceIds:[2]},{archived:true}])assert.deepEqual(documentFromRow(row,[{...base,...change}],'g').topic_ids,[]);
});
test('input rejects invalid calendar windows and unbounded searches',()=>{
  for(const input of [{from:'2026-02-30'},{from:'2026-09-02',to:'2026-09-01'},{limit:100000},{offset:-1}])assert.equal(searchInput.safeParse(input).success,false);
  assert.equal(topicInput.safeParse({name:'x',terms:[]}).success,false);
  assert.equal(safeUrl('javascript:alert(1)'),null);
  assert.equal(plainText('<script>steal()</script><p>正文</p>'),'正文');
});
test('task failure and missing configuration fail explicitly without exposing credentials',async()=>{
  await assert.rejects(()=>new MeiliClient('','').request('/health'),/radius_search_not_configured/);
  const client=new MeiliClient('http://127.0.0.1:58230','test-key',async()=>new Response(JSON.stringify({status:'failed',error:{code:'invalid_document_id'}})));
  await assert.rejects(()=>client.wait(1),(e:unknown)=>e instanceof MeiliError&&e.code==='invalid_document_id');
});
