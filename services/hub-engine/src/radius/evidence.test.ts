import test from 'node:test';
import assert from 'node:assert/strict';
import {askInput,comparisonWindow} from './question.js';
import {prepareEvidence,evidenceQuestion} from './evidence.js';
import type {RadiusStore} from './store.js';
test('trend evidence uses equally sized disjoint periods and needs evidence in both',async()=>{
 const input=askInput.parse({question:'近一个月 AI Agent 的讨论有哪些变化？'}),now=new Date('2026-10-02T02:00:00Z');
 const range=comparisonWindow(input,now)!;
 assert.equal(range.previous.from,'2026-08-04');assert.equal(range.previous.to,'2026-09-02');
 assert.equal(range.current.from,'2026-09-03');assert.equal(range.current.to,'2026-10-02');
 let n=0;const searches:unknown[]=[];
 const store={search:async(_user:string,search:unknown)=>{searches.push(search);return{total:1,items:++n===1?[]:[{id:'a',qa_eligible:true,source_id:1,material_kind:'stored_text'}]};}} as unknown as RadiusStore;
 const plan=await prepareEvidence(store,'user',input,now);
 assert.equal(plan.ready,false);assert.equal(plan.reason,'comparison_evidence_missing');assert.equal(searches.length,2);
 assert.match(evidenceQuestion(input,plan),/不用篇数推断赞同率/);
});
test('thin or stale-index evidence does not silently enable a paid answer',async()=>{
 const store={search:async()=>({total:2,items:[{id:'thin',qa_eligible:false},{id:'old-index',content_basis:'body'}]})} as unknown as RadiusStore;
 const plan=await prepareEvidence(store,'user',askInput.parse({question:'AI 教育有哪些案例？'}));
 assert.equal(plan.ready,false);assert.equal(plan.selected,0);
});

test('comparison rejects evidence repeated in both periods', async () => {
 const input=askInput.parse({question:'AI Agent 的讨论有哪些变化？',keywords:'AI Agent',mode:'compare'});
 for(const duplicate of ['url','body']) {
  let call=0;
  const store={search:async()=>({total:1,items:[{id:String(++call),source_id:call,qa_eligible:true,
   canonical_url:duplicate==='url'?'https://example.org/article?utm_source='+call:'https://example.org/article-'+call,
   body_hash:duplicate==='body'?'same-body':'body-'+call}]})} as unknown as RadiusStore;
  const plan=await prepareEvidence(store,'user',input,new Date('2026-10-10T00:00:00Z'));
  assert.equal(plan.ready,false,duplicate);
  assert.equal(plan.reason,'comparison_evidence_missing');
  assert.equal(plan.selected,1);
  assert.equal(plan.groups[1].selected.length,0);
 }
});

test('comparison fills the current period with independent alternatives', async () => {
 let call=0;
 const item=(id:string,hash:string)=>({id,qa_eligible:true,source_id:1,body_hash:hash});
 const store={search:async()=>++call===1?{total:1,items:[item('previous','repeated')]}:
  {total:2,items:[item('duplicate','repeated'),item('current','independent')]}} as unknown as RadiusStore;
 const plan=await prepareEvidence(store,'user',askInput.parse({question:'AI Agent 的趋势变化',mode:'compare'}));
 assert.equal(plan.ready,true);
 assert.deepEqual(plan.groups[1].selected.map(x=>x.id),['current']);
});

test('candidates not selected in the previous period remain eligible in the current one', async () => {
 let call=0;
 const items=Array.from({length:7},(_,i)=>({id:String(i),qa_eligible:true,source_id:1,body_hash:'body-'+i}));
 const store={search:async()=>({total:++call===1?7:1,items:call===1?items:[items[6]]})} as unknown as RadiusStore;
 const plan=await prepareEvidence(store,'user',askInput.parse({question:'AI Agent 的趋势变化',mode:'compare'}));
 assert.equal(plan.ready,true);
 assert.equal(plan.groups[0].selected.length,6);
 assert.deepEqual(plan.groups[1].selected.map(x=>x.id),['6']);
});
